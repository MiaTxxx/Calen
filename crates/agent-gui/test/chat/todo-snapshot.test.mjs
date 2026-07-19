import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { sanitizeTodoItems, pickLatestTodoSnapshot } = loader.loadModule(
  "src/pages/chat/components/assistant-bubble/TodoListView.tsx"
);

test("sanitizeTodoItems keeps incomplete streaming items with defaults", () => {
  const items = sanitizeTodoItems([
    { content: "设计页面" },
    { content: "实现动画", status: "in_progress", activeForm: "正在实现动画" },
    { content: "创建 HTML", status: "pending" },
    { foo: "bar" },
  ]);
  assert.equal(items.length, 3);
  assert.equal(items[0].status, "pending");
  assert.equal(items[0].activeForm, "设计页面");
  assert.equal(items[1].status, "in_progress");
  assert.equal(items[2].activeForm, "创建 HTML");
});

test("pickLatestTodoSnapshot prefers the latest settled result", () => {
  const snapshot = pickLatestTodoSnapshot([
    {
      toolCall: {
        name: "TodoWrite",
        arguments: {
          todos: [
            { content: "A", status: "in_progress", activeForm: "doing A" },
          ],
        },
      },
    },
    {
      toolCall: { name: "TodoWrite", arguments: { todos: [] } },
      toolResult: {
        isError: false,
        details: {
          kind: "todo_write",
          todos: [
            { content: "A", status: "completed", activeForm: "doing A" },
            { content: "B", status: "completed", activeForm: "doing B" },
            { content: "C", status: "completed", activeForm: "doing C" },
            { content: "D", status: "completed", activeForm: "doing D" },
          ],
        },
      },
    },
  ]);
  assert.equal(snapshot.settled, true);
  assert.equal(snapshot.todos.length, 4);
  assert.ok(snapshot.todos.every((todo) => todo.status === "completed"));
});
