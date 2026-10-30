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
