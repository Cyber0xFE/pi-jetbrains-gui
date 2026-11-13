// Scripted stand-in for `pi --mode rpc`, used by the M0 unit tests.
//
// Reads JSONL commands from stdin and answers with the records the tests expect. No LLM involved.
import process from "node:process";

const decoder = new TextDecoder("utf-8");
let buffer = "";

function send(record) {
	process.stdout.write(`${JSON.stringify(record)}\n`);
}

function handle(line) {
	let command;
	try {
		command = JSON.parse(line);
	} catch {
		send({ type: "response", command: "parse", success: false, error: "Failed to parse command" });
		return;
	}

	const id = command.id;
	switch (command.type) {
		case "get_proxy_environment":
			send({
				id,
				type: "response",
				command: command.type,
				success: true,
				data: { HTTP_PROXY: process.env.HTTP_PROXY ?? null, HTTPS_PROXY: process.env.HTTPS_PROXY ?? null },
			});
			return;
		case "get_state":
			send({
				id,
				type: "response",
				command: "get_state",
				success: true,
				data: {
					sessionId: "fake-session",
					thinkingLevel: "high",
					isStreaming: false,
					isCompacting: false,
					messageCount: 2,
					pendingMessageCount: 0,
					model: { id: "fake-model", name: "fake-model", provider: "fake" },
				},
			});
			return;
		case "get_available_models":
			send({
				id,
				type: "response",
				command: "get_available_models",
				success: true,
				data: {
					models: [
						{ id: "fake-model", name: "Fake Model", provider: "fake", reasoning: true, contextWindow: 200000 },
						{ id: "other-model", name: "Other Model", provider: "fake", contextWindow: 64000 },
					],
				},
			});
			return;
		case "get_available_thinking_levels":
			send({ id, type: "response", command: "get_available_thinking_levels", success: true, data: { levels: ["off", "low", "high"] } });
			return;
		case "get_commands":
			send({
				id,
				type: "response",
				command: "get_commands",
				success: true,
				data: {
					commands: [
						{ name: "review", description: "Review the diff", source: "prompt", sourceInfo: { path: "/p/review.md" } },
						{ name: "skill:draw", description: "Draw", source: "skill", sourceInfo: { path: "/p/skill.md" } },
					],
				},
			});
			return;
		case "get_tree":
			send({
				id,
				type: "response",
				command: "get_tree",
				success: true,
				data: {
					tree: [
						{
							entry: { type: "message", id: "entry-1", parentId: null, timestamp: "2025-10-30T00:00:00.000Z", message: { role: "user", content: "hi" } },
							children: [
								{
									entry: { type: "message", id: "entry-2", parentId: "entry-1", timestamp: "2025-10-30T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
									children: [],
								},
							],
						},
					],
					leafId: "entry-2",
				},
			});
			return;
		case "get_entries":
			send({
				id,
				type: "response",
				command: "get_entries",
				success: true,
				data: {
					entries: [
						{ type: "message", id: "entry-1", parentId: null, timestamp: "2025-10-30T00:00:00.000Z", message: { role: "user", content: "hi" } },
						{ type: "message", id: "entry-2", parentId: "entry-1", timestamp: "2025-10-30T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
					],
					leafId: "entry-2",
				},
			});
			return;
		case "broken_response":
			// The id is readable but the payload is not JSON: the client must fail the pending request
			// instead of waiting for its timeout.
			process.stdout.write(`{"id":"${id}","type":"response","command":"broken_response","success":true,"data":{"tree":[}\n`);
			return;
		case "switch_session":
			send({ id, type: "response", command: "switch_session", success: true, data: { cancelled: command.sessionPath === "cancel-me" } });
			return;
		case "new_session":
			send({ id, type: "response", command: "new_session", success: true, data: { cancelled: false } });
			return;
		case "fork":
			send({ id, type: "response", command: "fork", success: true, data: { text: "original prompt", cancelled: false } });
			return;
		case "compact":
			send({ id, type: "response", command: "compact", success: true, data: { tokensBefore: 1000, estimatedTokensAfter: 100 } });
			return;
		case "set_session_name":
			send({ id, type: "response", command: "set_session_name", success: true });
			return;
		case "set_model":
			send({
				id,
				type: "response",
				command: "set_model",
				success: true,
				data: { id: command.modelId, name: command.modelId, provider: command.provider },
			});
			return;
		case "set_thinking_level":
		case "set_auto_compaction":
		case "abort_retry":
			send({ id, type: "response", command: command.type, success: true });
			return;
		case "abort":
			// The queues are already empty: `clear_queue` runs before `abort` in the stop path.
			send({ id, type: "response", command: "abort", success: true });
			return;
		case "clear_queue":
			// One pending steering message and one follow-up, the TUI stop path hands both back.
			send({
				id,
				type: "response",
				command: "clear_queue",
				success: true,
				data: { steering: ["first steer"], followUp: ["then run the suite"] },
			});
			send({ type: "queue_update", steering: [], followUp: [] });
			return;
		case "echo":
			// A malformed record must be dropped by the client without breaking the stream.
			process.stdout.write("this is not json\n");
			send({ type: "message_start", message: { role: "user", content: command.message, timestamp: 1 } });
			send({
				type: "message_update",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "中文🙂" },
			});
			send({ type: "message_end", message: { role: "assistant", content: [], timestamp: 2 } });
			send({ id, type: "response", command: "echo", success: true, data: { disposition: "started" } });
			return;
		case "unicode_separator":
			// U+2028 and U+2029 are valid inside JSON strings and are not record boundaries.
			send({ type: "message_start", message: { role: "user", content: "a\u2028b\u2029c", timestamp: 1 } });
			send({ id, type: "response", command: "unicode_separator", success: true });
			return;
		case "hang":
			// Never answer: used for timeout and pending-request tests.
			return;
		case "die":
			process.exit(7);
			return;
		case "exit_after_reply":
			send({ id, type: "response", command: "exit_after_reply", success: true });
			process.exit(3);
			return;
		default:
			send({ id, type: "response", command: command.type, success: false, error: `unknown command: ${command.type}` });
	}
}

process.stdin.on("data", (chunk) => {
	buffer += decoder.decode(chunk, { stream: true });
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index).replace(/\r$/, "");
		buffer = buffer.slice(index + 1);
		if (line.trim().length > 0) handle(line);
		index = buffer.indexOf("\n");
	}
});

process.stdin.on("end", () => process.exit(0));
