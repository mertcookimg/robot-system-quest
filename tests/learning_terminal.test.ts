// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Exercises the real four lessons, terminal UI/parser, topic monitor and stage
// transition machinery. This verifies simulated ROS behavior, not a real ROS graph.
import test, { before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";
import type { RuntimeState } from "../src/lib/terminal";
import { evaluateWorldAction, WORLD_INITIAL } from "../src/lib/world_model";

const ids = ["imitation_learning", "reinforcement_learning", "vla_lab", "world_model"] as const;
type LessonId = (typeof ids)[number];
const contracts = {
  imitation_learning: { node: "/imitation_lab", topic: "/imitation/data", panel: ".imitation-lab" },
  reinforcement_learning: { node: "/rl_lab", topic: "/learning", panel: ".reinforcement-lab" },
  vla_lab: { node: "/vla_policy", topic: "/vla/action", panel: ".vla-lab" },
  world_model: { node: "/world_model_planner", topic: "/world_model/trial", panel: ".world-lab" },
} as const;
let browser: Window;
let server: ViteDevServer;
let manager: typeof import("../src/core/stage_manager");
let terminal: typeof import("../src/core/terminal_ui");
let monitor: typeof import("../src/core/topic_monitor");
let execCommand: (typeof import("../src/lib/terminal"))["execCommand"];
let timers: typeof import("../src/core/stage_timers");
let ui: (typeof import("../src/core/dom"))["ui"];
let setLang: (lang: "en" | "ja") => void;
let stageDisplayName: (typeof import("../src/core/stage_labels"))["stageDisplayName"];
const factories = new Map<LessonId, () => Stage>();
const descriptors = new Map<string, PropertyDescriptor | undefined>();
let active = false;

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "FocusEvent",
    "KeyboardEvent",
    "PointerEvent",
    "MutationObserver",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  localStorage.setItem("robot_audio", "off");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  for (const [id, factory] of [
    ["imitation_learning", "makeImitationLearning"],
    ["reinforcement_learning", "makeReinforcementLearning"],
    ["vla_lab", "makeVlaLab"],
    ["world_model", "makeWorldModel"],
  ] as const) {
    const module = await server.ssrLoadModule(`/src/stages/lesson/${id}.ts`);
    factories.set(id, module[factory]);
  }
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  terminal = (await server.ssrLoadModule("/src/core/terminal_ui.ts")) as typeof terminal;
  monitor = (await server.ssrLoadModule("/src/core/topic_monitor.ts")) as typeof monitor;
  execCommand = (await server.ssrLoadModule("/src/lib/terminal.ts")).execCommand;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
  stageDisplayName = (await server.ssrLoadModule("/src/core/stage_labels.ts")).stageDisplayName;
  manager.setStages([placeholder()]);
  terminal.setupTerminal({
    getConcept: () => manager.getCurrent().ros2,
    getStageName: () => stageDisplayName(manager.getCurrent()),
  });
});

function placeholder(): Stage {
  return {
    id: "terminal-fixture",
    name: "Fixture",
    lesson: "",
    lessonCmd: "",
    init() {},
    update() {},
    draw() {},
    reset() {},
    dispose() {},
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("robot_audio", "off");
  localStorage.setItem("robot_quest_lesson_seen_v1", JSON.stringify(ids));
  ui.introScreen.classList.remove("show");
  ui.lessonModal.classList.remove("show");
  setLang("en");
  manager.setStages([placeholder(), ...ids.map((id) => factories.get(id)!())]);
  manager.buildGameContext(
    ui.canvas,
    new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D,
  );
  active = false;
});

afterEach(() => {
  timers.clearStageTimeouts();
  terminal.closePadPalette();
  if (active) manager.getCurrent().dispose();
  active = false;
  monitor.clearLog();
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function load(id: LessonId): void {
  manager.loadStage(id);
  active = true;
  assert.equal(manager.getCurrentId(), id);
}
function outputSince(index: number): string[] {
  return [...ui.terminalBody.children]
    .slice(index)
    .filter((node) => node.classList.contains("tline-out"))
    .map((node) => node.textContent!);
}
function key(value: string): void {
  ui.terminalInput.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
}
function run(command: string): string[] {
  const count = ui.terminalBody.children.length;
  ui.terminalInput.value = command;
  key("Enter");
  assert.equal(ui.terminalInput.value, "");
  return outputSince(count);
}
function selectedRun(command: string): string[] {
  const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
  assert.ok(
    [...select.options].some((option) => option.value === command),
    `Missing selectable ${command}`,
  );
  const count = ui.terminalBody.children.length;
  select.value = command;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(ui.terminalInput.value, command);
  document.getElementById("terminal-command-run")!.click();
  return outputSince(count);
}
function click(id: LessonId, action: string): void {
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>(
      `${contracts[id].panel} button[data-action="${action}"]`,
    ),
  ];
  const button = buttons.find((button) => !button.disabled && !button.closest("[hidden]"));
  assert.ok(button, `Missing visible enabled ${id}/${action}`);
  button.click();
}
function untilMessage(topic: string, maxFrames = 300): void {
  for (let i = 0; i < maxFrames && monitor.recentMessages(topic).length === 0; i++) {
    manager.getCurrent().update(0.1);
  }
  assert.ok(monitor.recentMessages(topic).length > 0, `No real lesson event published to ${topic}`);
}
function publishFromLesson(id: LessonId): void {
  if (id === "imitation_learning") {
    click(id, "manual");
    click(id, "start");
  } else if (id === "reinforcement_learning") click(id, "train");
  else if (id === "vla_lab") click(id, "run");
  else {
    click(id, "continue");
    click(id, "continue");
  }
  untilMessage(contracts[id].topic);
}

for (const id of ids) {
  test(`${id}: terminal inspects its declared graph and the real lesson's messages`, () => {
    load(id);
    const { node, topic } = contracts[id];
    const concept = manager.getCurrent().ros2;
    assert.ok(concept?.state, "Lesson must supply the graph used by the terminal");
    assert.deepEqual(run("ros2 node list"), [node]);
    assert.ok(run("ros2 topic list -t").includes(`${topic} [std_msgs/msg/String]`));
    assert.deepEqual(run(`ros2 topic type ${topic}`), ["std_msgs/msg/String"]);
    const info = run(`ros2 topic info ${topic}`);
    assert.ok(info.includes("Publisher count: 1"));
    assert.ok(info.includes("Subscription count: 0"));
    assert.match(run(`ros2 node info ${node}`).join("\n"), new RegExp(topic));
    assert.deepEqual(run("ros2 interface show std_msgs/msg/String"), ["string data"]);
    assert.deepEqual(run("ros2 service list"), ["(no services in this stage)"]);
    assert.deepEqual(run("ros2 action list"), ["(no actions in this stage)"]);
    const recommendation = terminal.recommendedCommand();
    assert.equal(ui.lessonCmd.textContent, recommendation);
    assert.doesNotMatch(run(recommendation).join("\n"), /not found|not implemented|unknown/i);

    assert.equal(monitor.recentMessages(topic).length, 0);
    const initial = selectedRun(`ros2 topic echo ${topic}`).join("\n");
    assert.doesNotMatch(initial, /not found/i);
    assert.match(initial, /no recorded messages/i);
    assert.match(initial, /snapshot.*0 messages/i);
    const previousOutput = ui.terminalBody.textContent;
    publishFromLesson(id);
    // Echo is a saved-log snapshot, not a live subscription or background process.
    assert.equal(ui.terminalBody.textContent, previousOutput);
    const messages = monitor.recentMessages(topic, 5);
    assert.ok(messages.length > 0);
    for (const message of messages) {
      assert.match(message.msg, /^data: /);
      assert.equal(typeof JSON.parse(message.msg.slice(6)), "string");
    }
    const echoed = run(`ros2 topic echo ${topic}`);
    for (const message of messages) assert.ok(echoed.includes(message.msg));
    monitor.render(ui.topic);
    assert.match(ui.topic.textContent!, new RegExp(topic));
    assert.ok(ui.topic.textContent!.includes(messages.at(-1)!.msg));

    terminal.openPadPalette();
    const rows = [...document.getElementById("terminal-pad-palette")!.children];
    const echoIndex = rows.findIndex((row) =>
      row.textContent?.includes(`ros2 topic echo ${topic}`),
    );
    assert.ok(echoIndex >= 0);
    terminal.paletteMove(echoIndex);
    const before = ui.terminalBody.children.length;
    terminal.paletteExec();
    assert.ok(outputSince(before).includes(messages.at(-1)!.msg));
    terminal.closePadPalette();
  });
}

test("L21 reports actual data collection, completed fitting and three-course evaluation", () => {
  load("imitation_learning");
  publishFromLesson("imitation_learning");
  // Finish the recording before selecting the next learning step.
  for (let i = 0; i < 180; i++) manager.getCurrent().update(0.1);
  click("imitation_learning", "train");
  untilMessage("/imitation/training");
  click("imitation_learning", "compare");
  untilMessage("/imitation/evaluation", 500);
  for (const topic of ["/imitation/data", "/imitation/training", "/imitation/evaluation"]) {
    const saved = monitor.recentMessages(topic).at(-1)!;
    assert.ok(saved);
    assert.ok(run(`ros2 topic echo ${topic}`).includes(saved.msg));
  }
});

test("L21 completion retains usable review and Start over clears its recorded telemetry", () => {
  load("imitation_learning");
  publishFromLesson("imitation_learning");
  for (let i = 0; i < 180; i++) manager.getCurrent().update(0.1);
  click("imitation_learning", "train");
  untilMessage("/imitation/training");
  click("imitation_learning", "compare");
  untilMessage("/imitation/evaluation", 500);
  const panel = document.querySelector<HTMLElement>(".imitation-lab")!;
  click("imitation_learning", "finish");
  assert.equal(panel.inert, true);
  assert.ok(ui.clearOverlay.parentElement === document.body);
  ui.clearOverlay.dispatchEvent(
    new window.CustomEvent("clear-overlay-close", { detail: { reason: "dismiss" } }),
  );
  assert.equal(panel.inert, false);
  assert.equal(panel.dataset.cleared, "true");
  assert.equal((document.activeElement as HTMLElement).dataset.action, "restart");
  click("imitation_learning", "toggle-help");
  assert.equal(panel.dataset.panel, "help");
  click("imitation_learning", "toggle-help");
  assert.equal(panel.dataset.cleared, "true");
  assert.ok(monitor.recentMessages("/imitation/evaluation").length);
  run("ros2 topic echo /imitation/evaluation");
  click("imitation_learning", "restart");
  assert.equal(document.querySelector<HTMLElement>(".imitation-lab")!.dataset.cleared, "false");
  assert.equal(monitor.recentMessages("/imitation/evaluation").length, 0);
  assert.equal(monitor.recentMessages("/imitation/data").length, 0);
  assert.doesNotMatch(ui.terminalBody.textContent!, /evaluation_complete/);
});

for (const id of ["reinforcement_learning", "vla_lab", "world_model"] as const) {
  test(`${id}: panel Reset uses the runtime cleanup for logs, shell history and palette`, () => {
    load(id);
    publishFromLesson(id);
    for (let i = 0; i < 70; i++) manager.getCurrent().update(0.1);
    const topic = contracts[id].topic;
    assert.ok(monitor.recentMessages(topic).length);
    run(`ros2 topic echo ${topic}`);
    terminal.openPadPalette();
    if (id === "world_model") click(id, "details");
    click(id, "reset");
    assert.equal(monitor.recentMessages(topic).length, 0);
    assert.equal(terminal.isPadPaletteOpen(), false);
    assert.doesNotMatch(ui.terminalBody.textContent!, /\$ ros2 topic echo/);
    key("ArrowUp");
    assert.equal(ui.terminalInput.value, "");
  });
}

test("L22 evaluation and L24 actual result can be inspected after their real comparisons", () => {
  load("reinforcement_learning");
  click("reinforcement_learning", "train");
  for (let i = 0; i < 22; i++) manager.getCurrent().update(0.1);
  click("reinforcement_learning", "compare");
  const evaluation = monitor.recentMessages("/rl/evaluation").at(-1);
  assert.ok(evaluation);
  assert.ok(run("ros2 topic echo /rl/evaluation").includes(evaluation.msg));
  load("world_model");
  publishFromLesson("world_model");
  untilMessage("/world_model/result", 25);
  const result = monitor.recentMessages("/world_model/result").at(-1)!;
  assert.match(result.msg, /actual_x=/);
  assert.match(result.msg, /prediction_error_m=/);
  const fields = Object.fromEntries(
    (JSON.parse(result.msg.slice(6)) as string).split(" ").map((field) => field.split("=")),
  );
  const expected = evaluateWorldAction("weak", WORLD_INITIAL);
  assert.equal(fields.experiment, "near");
  assert.equal(fields.action, "weak");
  assert.equal(Number(fields.predicted_x), expected.prediction.finalX);
  assert.equal(Number(fields.actual_x), expected.actual.finalX);
  assert.equal(Number(fields.prediction_error_m), expected.error);
  assert.ok(run("ros2 topic echo /world_model/result").includes(result.msg));
});

test("stage transitions clear old topic data, terminal history and command choices", () => {
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    load(id);
    assert.equal(monitor.recentMessages().length, 0);
    assert.equal(ui.terminalInput.value, "");
    key("ArrowUp");
    assert.equal(ui.terminalInput.value, "", "History must not leak from the previous lesson");
    const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
    assert.equal(select.value, "");
    if (index > 0) {
      const previous = contracts[ids[index - 1]].topic;
      assert.match(run(`ros2 topic echo ${previous}`).join("\n"), /not found/);
      assert.ok(![...select.options].some((option) => option.value.includes(previous)));
    }
    publishFromLesson(id);
    run(`ros2 topic echo ${contracts[id].topic}`);
    terminal.openPadPalette();
    // loadStage must close the previous stage's palette as well as its history.
    if (index < ids.length - 1) {
      load(ids[index + 1]);
      assert.equal(terminal.isPadPaletteOpen(), false);
    }
  }
});

test("mini-lab terminals reject mutations and do not invent parameters or lifecycle states", () => {
  for (const id of ids) {
    load(id);
    const { node, topic } = contracts[id];
    const before = JSON.stringify(manager.getCurrent().ros2?.state);
    for (const command of [
      `ros2 topic pub ${topic} std_msgs/msg/String '{data: changed}'`,
      "ros2 service call /train std_srvs/srv/Trigger '{}'",
      `ros2 param set ${node} max_speed 9`,
      `ros2 lifecycle set ${node} activate`,
      "ros2 run fake_package fake_node",
    ])
      assert.match(run(command).join("\n"), /not available|not supported|not exposed/i);
    assert.equal(monitor.recentMessages().length, 0);
    assert.equal(JSON.stringify(manager.getCurrent().ros2?.state), before);
    assert.doesNotMatch(
      run(`ros2 param list ${node}`).join("\n"),
      /max_speed|turn_gain|use_sim_time/,
    );
    assert.doesNotMatch(run(`ros2 param get ${node} max_speed`).join("\n"), /max_speed:\s*0\.4/);
    assert.doesNotMatch(run(`ros2 lifecycle get ${node}`).join("\n"), /active \[3\]/);
  }
});

test("language switching retains lesson messages and refreshes terminal commands", () => {
  load("world_model");
  publishFromLesson("world_model");
  const saved = monitor.recentMessages("/world_model/trial").at(-1)!;
  setLang("ja");
  assert.match(ui.terminalStage.textContent!, /世界モデルミニラボ/);
  assert.ok(selectedRun("ros2 topic echo /world_model/trial").includes(saved.msg));
  assert.ok(manager.getCurrent().ros2?.title.includes("世界モデル"));
  setLang("en");
  assert.ok(run("ros2 topic echo /world_model/trial").includes(saved.msg));
  ui.terminalInput.focus();
  key("Escape");
  assert.ok(document.activeElement !== ui.terminalInput, "Escape must leave terminal input");
});

test("explicit parameter and lifecycle capabilities reflect current state without leaking to other nodes", () => {
  const state: RuntimeState = {
    nodes: ["/managed", "/ordinary"],
    topics: [],
    recentMessages: () => [],
    parameters: { "/managed": { gain: 1.25, use_sim_time: true } },
    lifecycle: { "/managed": { id: 2, label: "inactive" } },
  };
  const inspect = (command: string) => execCommand(command, state).lines;
  assert.deepEqual(inspect("ros2 param list /managed"), ["  gain", "  use_sim_time"]);
  assert.deepEqual(inspect("ros2 param get /managed gain"), ["gain: 1.25"]);
  assert.ok(inspect("ros2 param dump /managed").includes("    use_sim_time: true"));
  assert.deepEqual(inspect("ros2 lifecycle get /managed"), ["inactive [2]"]);
  state.parameters!["/managed"].gain = 2.5;
  state.lifecycle!["/managed"] = { id: 3, label: "active" };
  assert.deepEqual(inspect("ros2 param get /managed gain"), ["gain: 2.5"]);
  assert.deepEqual(inspect("ros2 lifecycle get /managed"), ["active [3]"]);
  assert.doesNotMatch(inspect("ros2 param list /ordinary").join("\n"), /gain|use_sim_time/);
  assert.doesNotMatch(inspect("ros2 lifecycle get /ordinary").join("\n"), /active \[3\]/);
  const snapshot = JSON.stringify(state);
  assert.match(inspect("ros2 param set /managed gain 99").join("\n"), /not available/);
  assert.match(inspect("ros2 lifecycle set /managed deactivate").join("\n"), /not available/);
  assert.equal(JSON.stringify(state), snapshot);
});

test("terminal keyboard history stays local and doctor reports the simulated graph", () => {
  load("world_model");
  let propagated = 0;
  const listener = () => propagated++;
  window.addEventListener("keydown", listener);
  try {
    ui.terminalInput.focus();
    run("ros2 node list");
    run("ros2 topic list");
    key("ArrowUp");
    assert.equal(ui.terminalInput.value, "ros2 topic list");
    key("ArrowUp");
    assert.equal(ui.terminalInput.value, "ros2 node list");
    key("ArrowDown");
    assert.equal(ui.terminalInput.value, "ros2 topic list");
    key("ArrowDown");
    assert.equal(ui.terminalInput.value, "");
    key("Escape");
    for (const id of ["terminal-command-select", "terminal-command-run"]) {
      const control = document.getElementById(id)!;
      control.focus();
      for (const value of ["Enter", " "]) {
        const event = new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        });
        control.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `${id} must retain native ${value} behavior`);
      }
    }
    assert.equal(propagated, 0, "Typing terminal commands must not also trigger lesson shortcuts");
  } finally {
    window.removeEventListener("keydown", listener);
  }
  const diagnostic = run("ros2 doctor").join("\n");
  assert.match(diagnostic, /simulat/i);
  assert.match(diagnostic, /1 node/);
  assert.match(diagnostic, /2 topic/);
  assert.doesNotMatch(diagnostic, /All 1 checks passed/);
});
