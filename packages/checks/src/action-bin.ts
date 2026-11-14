import { ACTION_EXIT, command, runAction } from "./action";

runAction(process.env, { stdout: (text) => process.stdout.write(text) }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${command("error", { title: "Lorequill" }, message)}\n`);
    process.exitCode = ACTION_EXIT.error;
  },
);
