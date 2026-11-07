// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// All-stage shell contracts use the real DOM, stages, parser and topic log.
// Canvas operations are no-ops: this verifies telemetry, not rendered pixels.
import test, { before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage, Ros2State } from "../src/types";

const files = (
  await Promise.all(
    ["game", "lesson"].map(async (mode) =>
      (await readdir(new URL(`../src/stages/${mode}/`, import.meta.url)))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => ({ mode, id: name.slice(0, -3) })),
    ),
  )
).flat();
let browser: Window;
let server: ViteDevServer;
let manager: typeof import("../src/core/stage_manager");
let terminal: typeof import("../src/core/terminal_ui");
let monitor: typeof import("../src/core/topic_monitor");
let timers: typeof import("../src/core/stage_timers");
let clear: typeof import("../src/core/clear_overlay");
let input: typeof import("../src/core/input");
let commands: typeof import("../src/lib/terminal_commands");
let ui: (typeof import("../src/core/dom"))["ui"];
const factories = new Map<string, () => Stage>();
const descriptors = new Map<string, PropertyDescriptor | undefined>();
let current: Stage | undefined;
let published: Array<{ topic: string; msg: string }> = [];

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const pixels = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
  });
  return new Proxy(
    { canvas },
    {
      get(target, key) {
        if (key === "canvas") return target.canvas;
        if (key === "getImageData")
          return (_x: number, _y: number, w: number, h: number) => pixels(w, h);
        if (key === "createImageData") return pixels;
        if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
        if (String(key).startsWith("create") && String(key).endsWith("Gradient"))
          return () => ({ addColorStop() {} });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "Element",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLCanvasElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "FocusEvent",
    "KeyboardEvent",
    "PointerEvent",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "DOMRect",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    "matchMedia",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "window" ? browser : Reflect.get(browser, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        typeof value === "function" &&
        [
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "getComputedStyle",
          "matchMedia",
        ].includes(key)
          ? value.bind(browser)
          : value,
    });
  }
  browser.HTMLCanvasElement.prototype.getContext = function () {
    return canvasContext(this as unknown as HTMLCanvasElement);
  } as typeof browser.HTMLCanvasElement.prototype.getContext;
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
  for (const { mode, id } of files) {
    const module = await server.ssrLoadModule(`/src/stages/${mode}/${id}.ts`);
    factories.set(id, module.default.build);
  }
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  terminal = (await server.ssrLoadModule("/src/core/terminal_ui.ts")) as typeof terminal;
  monitor = (await server.ssrLoadModule("/src/core/topic_monitor.ts")) as typeof monitor;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  clear = (await server.ssrLoadModule("/src/core/clear_overlay.ts")) as typeof clear;
  input = (await server.ssrLoadModule("/src/core/input.ts")) as typeof input;
  commands = (await server.ssrLoadModule("/src/lib/terminal_commands.ts")) as typeof commands;
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  const language = await server.ssrLoadModule("/src/i18n/index.ts");
  language.setLang("en");
  ui.canvas.getBoundingClientRect = () => new DOMRect(0, 0, ui.canvas.width, ui.canvas.height);
  manager.setStages([placeholder()]);
  terminal.setupTerminal({
    getConcept: () => manager.getCurrent().ros2,
    getStageName: () => manager.getCurrent().name,
  });
});

function placeholder(): Stage {
  return {
    id: "shell-fixture",
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
  published = [];
  current = undefined;
  localStorage.clear();
  localStorage.setItem("robot_audio", "off");
  localStorage.setItem("robot_quest_lesson_seen_v1", JSON.stringify(files.map((file) => file.id)));
  ui.introScreen.classList.remove("show");
  ui.lessonModal.classList.remove("show");
  clear.close();
  input.clearAll();
  input.syncKeys();
});

afterEach(() => {
  timers.clearStageTimeouts();
  terminal.closePadPalette();
  current?.dispose();
  current = undefined;
  monitor.clearLog();
  input.clearAll();
  input.syncKeys();
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function load(id: string): Stage {
  const stage = factories.get(id)!();
  manager.setStages([placeholder(), stage]);
  const game = manager.buildGameContext(ui.canvas, canvasContext(ui.canvas));
  const publish = game.publish;
  game.publish = (topic, msg) => {
    published.push({ topic, msg });
    publish(topic, msg);
  };
  manager.loadStage(id);
  current = stage;
  return stage;
}

function run(command: string): string[] {
  const before = ui.terminalBody.children.length;
  ui.terminalInput.value = command;
  ui.terminalInput.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  return [...ui.terminalBody.children]
    .slice(before)
    .filter((node) => node.classList.contains("tline-out"))
    .map((node) => node.textContent!);
}

function assertGraph(stage: Stage): Ros2State {
  const state = stage.ros2?.state;
  assert.ok(state, `${stage.id} must declare its simulated graph`);
  assert.equal(new Set(state.nodes).size, state.nodes.length, `${stage.id}: duplicate nodes`);
  assert.equal(new Set(state.topics.map((topic) => topic.name)).size, state.topics.length);
  for (const topic of state.topics) {
    assert.match(topic.name, /^\//);
    assert.match(topic.type, /^[A-Za-z][\w]*\/msg\/[A-Za-z][\w]*$/);
    for (const endpoint of [...(topic.pub ?? []), ...(topic.sub ?? [])])
      assert.ok(
        state.nodes.includes(endpoint),
        `${stage.id}: ${topic.name} has unknown endpoint ${endpoint}`,
      );
  }
  for (const service of state.services ?? []) {
    assert.match(service.type, /^[A-Za-z][\w]*\/srv\/[A-Za-z][\w]*$/);
    if (service.node)
      assert.ok(
        state.nodes.includes(service.node),
        `${stage.id}: unknown service node ${service.node}`,
      );
  }
  for (const action of state.actions ?? []) {
    assert.match(action.type, /^[A-Za-z][\w]*\/action\/[A-Za-z][\w]*$/);
    for (const endpoint of [...(action.clients ?? []), ...(action.servers ?? [])])
      assert.ok(
        state.nodes.includes(endpoint),
        `${stage.id}: ${action.name} has unknown endpoint ${endpoint}`,
      );
  }
  for (const node of [
    ...Object.keys(state.parameters ?? {}),
    ...Object.keys(state.lifecycle ?? {}),
  ])
    assert.ok(state.nodes.includes(node), `${stage.id}: managed node ${node} is absent from graph`);
  return state;
}

function assertCommands(): void {
  const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
  select.dispatchEvent(new Event("focus"));
  const offered = [...select.options].map((option) => option.value).filter(Boolean);
  assert.deepEqual(
    offered,
    commands.inspectionCommands(current?.ros2),
    "Palette must expose shared command list",
  );
  assert.ok(offered.includes("ros2 topic list"));
  const recommended = terminal.recommendedCommand();
  assert.ok(offered.includes(recommended), `Recommendation absent from palette: ${recommended}`);
  for (const command of offered.filter((command) => command !== "clear")) {
    const output = run(command).join("\n");
    assert.doesNotMatch(
      output,
      /not found|not implemented|not in this game's database|unknown\/|unknown action type|Command not implemented/i,
      `${manager.getCurrentId()}: ${command}\n${output}`,
    );
  }
}

function advance(stage: Stage, seconds = 0.4): void {
  for (let frame = 0; frame < Math.ceil(seconds / 0.05); frame++) stage.update(0.05);
}

function clickRun(): void {
  const button = document.getElementById("be-run") as HTMLButtonElement;
  assert.ok(button && !button.disabled, "RUN must be available");
  button.click();
}

function connectBuilder(): void {
  ui.canvas.dispatchEvent(
    new MouseEvent("mousedown", { clientX: 330, clientY: 170, bubbles: true }),
  );
  ui.canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 470, clientY: 170, bubbles: true }));
}

function expectTopics(...topics: string[]): void {
  for (const topic of topics)
    assert.ok(
      published.some((event) => event.topic === topic),
      `Expected actual publication on ${topic}`,
    );
}

function hold(stage: Stage, key: string, seconds = 0.4): void {
  // Ordinary stages read the merged input set; local multiplayer stages own
  // window listeners so keyboard and pad inputs remain separate per player.
  // Returning to play explicitly leaves any previously focused shell control.
  ui.canvas.tabIndex = 0;
  ui.canvas.focus();
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  input.setKbKey(key, true);
  input.syncKeys();
  advance(stage, seconds);
  input.setKbKey(key, false);
  input.syncKeys();
  window.dispatchEvent(new KeyboardEvent("keyup", { key }));
}

function overlayButton(label: RegExp): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(".overlay-choice-button, .bt-action"),
  ].find((candidate) => label.test(candidate.textContent ?? ""));
  assert.ok(button, `Stage control ${label} exists`);
  return button;
}

function checkEmitted(stage: Stage): void {
  const state = assertGraph(stage);
  for (const event of published) {
    assert.ok(
      state.topics.some((topic) => topic.name === event.topic),
      `${stage.id}: emitted undeclared topic ${event.topic}`,
    );
  }
  for (const topic of new Set(published.map((event) => event.topic))) {
    const recent = monitor.recentMessages(topic, 5);
    if (recent.length) {
      const output = run(`ros2 topic echo ${topic}`);
      for (const message of recent) assert.ok(output.includes(message.msg));
    }
  }
}

test("all 14 games and 24 lessons are included in the terminal audit", () => {
  assert.equal(files.filter((file) => file.mode === "game").length, 14);
  assert.equal(files.filter((file) => file.mode === "lesson").length, 24);
});

for (const { mode, id } of files) {
  test(`${mode}/${id}: declared graph, available commands and idle telemetry agree`, () => {
    // The guide reads all registry factories before a stage has been initialized.
    const cold = factories.get(id)!();
    assertGraph(cold);
    assert.doesNotThrow(() => JSON.stringify(cold.ros2));
    assert.ok(
      commands
        .inspectionCommands(cold.ros2)
        .includes(commands.recommendedInspectionCommand(cold.ros2)),
    );
    const stage = load(id);
    assertGraph(stage);
    assertCommands();
    advance(stage);
    checkEmitted(stage);
  });
}

for (const id of [
  "feedforward_controller",
  "feedforward_mission",
  "feedback_controller",
  "feedback_mission",
  "lidar_avoidance",
  "param_tuner",
  "edge_detection",
  "object_detection",
  "image_processing",
]) {
  test(`${id}: RUN drives actual declared telemetry visible in the terminal`, () => {
    const stage = load(id);
    published = [];
    clickRun();
    advance(stage);
    assert.ok(published.length > 0, `${id}: running the default program must publish`);
    checkEmitted(stage);
    assertCommands();
  });
}

test("Pub/Sub wiring starts data flow, while a disconnected graph does not fabricate messages", () => {
  const stage = load("pubsub_builder");
  advance(stage);
  assert.equal(published.length, 0);
  connectBuilder();
  advance(stage);
  expectTopics("/cmd_vel", "/odom");
  checkEmitted(stage);
  assertCommands();
});

test("service wiring and CALL report a real request/response on the diagnostic topic", () => {
  const stage = load("service_builder");
  const call = overlayButton(/CALL/);
  call.click();
  assert.equal(published.length, 0, "Disconnected CALL must not fabricate a response");
  connectBuilder();
  advance(stage);
  call.click();
  expectTopics("/service/events");
  checkEmitted(stage);
  assert.match(run("ros2 service type /toggle_lamp").join("\n"), /std_srvs\/srv\/Trigger/);
});

test("action wiring exposes real clients/servers and emits execution diagnostics", () => {
  const stage = load("action_builder");
  advance(stage);
  assert.equal(published.length, 0);
  connectBuilder();
  advance(stage, 0.8);
  expectTopics("/action_builder/events");
  checkEmitted(stage);
  const action = stage.ros2!.state!.actions!.find((entry) => entry.name === "/navigate_to_pose")!;
  assert.deepEqual(action.clients, ["/nav_client"]);
  assert.deepEqual(action.servers, ["/nav_server"]);
  const info = run("ros2 action info /navigate_to_pose").join("\n");
  assert.match(info, /Action clients: 1/);
  assert.match(info, /Action servers: 1/);
});

test("live parameter edits update both observed values and parameter-event telemetry", () => {
  const stage = load("param_tuner");
  assert.match(run("ros2 param get /waypoint_driver max_speed").join("\n"), /0\.4/);
  clickRun();
  advance(stage);
  const value = document.querySelector<HTMLInputElement>('input[aria-label="max_speed"]');
  assert.ok(value, "Editable max_speed parameter exists");
  value.value = "0.65";
  value.dispatchEvent(new Event("input", { bubbles: true }));
  advance(stage);
  assert.match(run("ros2 param get /waypoint_driver max_speed").join("\n"), /0\.65/);
  expectTopics("/parameter_events");
  assert.match(run("ros2 topic echo /parameter_events").join("\n"), /max_speed.*0\.65/);
  checkEmitted(stage);
  stage.reset();
  assert.match(
    run("ros2 param get /waypoint_driver max_speed").join("\n"),
    /0\.65/,
    "Reset preserves the program's edited parameter",
  );
});

test("lifecycle inspection reflects patrol's managed state and absent nodes do not gain defaults", () => {
  const stage = load("patrol");
  advance(stage);
  assert.match(run("ros2 lifecycle get /warden").join("\n"), /active \[3\]/);
  stage.reset();
  assert.match(run("ros2 lifecycle get /warden").join("\n"), /active \[3\]/);
  assert.match(
    run("ros2 lifecycle get /player").join("\n"),
    /not.*(managed|lifecycle)|not available|not found/i,
  );
  assert.match(
    run("ros2 param get /player use_sim_time").join("\n"),
    /not.*(parameter|exposed)|not available|not found/i,
  );
});

test("guide examples cannot invent runtime resources or offer unsupported mutations", () => {
  const stage = load("delivery");
  const concept = stage.ros2!;
  concept.cli.push(
    "ros2 topic echo /not_a_runtime_topic",
    "ros2 action info /not_a_runtime_action",
    "ros2 param set /teleop speed 100",
    "ros2 topic echo /cmd_vel > /tmp/log",
  );
  assertCommands();
  assert.doesNotMatch(run("ros2 topic list").join("\n"), /not_a_runtime_topic/);
  assert.doesNotMatch(run("ros2 action list").join("\n"), /not_a_runtime_action/);
  const offered = commands.inspectionCommands(concept);
  assert.ok(offered.every((command) => !/not_a_runtime_|param set|>/.test(command)));
});

for (const [id, topic, warmup] of [
  ["battery_rush", "/robot/manual_control/cmd_vel", 0],
  ["delivery", "/robot/manual_control/cmd_vel", 0],
  ["follower", "/robot/manual_control/cmd_vel", 0],
  ["lidar_explorer", "/cmd_vel", 0],
  ["patrol", "/cmd_vel", 0],
  ["racing", "/cmd_vel", 4],
  ["robo_soccer", "/cmd_vel", 4],
  ["sumo_battle", "/robot/manual_control/cmd_vel", 0],
  ["tag_chase", "/runner/cmd_vel", 4],
  ["treasure_map", "/cmd_vel", 0],
  ["mapping_mission", "/cmd_vel", 0],
  ["localization_mission", "/cmd_vel", 0],
] as const) {
  test(`${id}: driving produces command telemetry from the actual stage`, () => {
    const stage = load(id);
    advance(stage, warmup);
    published = [];
    hold(stage, "w");
    expectTopics(topic);
    assert.ok(
      published.some(
        (event) =>
          event.topic === topic && Number(event.msg.match(/linear\.x:\s*([\d.-]+)/)?.[1]) > 0,
      ),
      "Forward input must produce a nonzero movement command",
    );
    checkEmitted(stage);
    assertCommands();
  });
}

for (const [id, topic] of [
  ["joint_teleop", "/joint_states"],
  ["ik_reach", "/tip_target"],
  ["pick_place", "/target_pose"],
  ["robo_kitchen", "/joint_states"],
] as const) {
  test(`${id}: arm controls change observed joint or target values`, () => {
    const stage = load(id);
    advance(stage);
    const before = monitor.recentMessages(topic, 1)[0]?.msg;
    assert.ok(before, "Arm state is observable before motion");
    hold(stage, "w");
    const after = monitor.recentMessages(topic, 1)[0]?.msg;
    assert.notEqual(after, before, "Moving the arm must change its observed state");
    expectTopics("/joint_states");
    if (id === "pick_place") {
      hold(stage, "enter", 0.05);
      expectTopics("/gripper/events");
    }
    checkEmitted(stage);
  });
}

test("navigation's drag gesture publishes a goal, computed plan and control", () => {
  const stage = load("navigation");
  ui.canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 170, clientY: 80, button: 0 }));
  ui.canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 80, button: 0 }));
  advance(stage);
  expectTopics("/goal_pose", "/plan", "/cmd_vel");
  checkEmitted(stage);
  assertCommands();
});

test("localization recovery produces an event without inventing a service-shaped topic", () => {
  const stage = load("localization_mission");
  overlayButton(/GLOBAL RELOCALIZE/).click();
  expectTopics("/localization/events");
  checkEmitted(stage);
  assert.doesNotMatch(run("ros2 topic list").join("\n"), /reinitialize_global_localization/);
  assert.match(run("ros2 service list").join("\n"), /reinitialize_global_localization/);
});

test("TF slider edits change the actual transform echoed by the shell", () => {
  const stage = load("tf_puzzle");
  const slider = document.querySelector<HTMLInputElement>("#tf-puzzle-panel input");
  assert.ok(slider);
  slider.value = "7";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  advance(stage);
  expectTopics("/tf_static");
  assert.match(run("ros2 topic echo /tf_static").join("\n"), /tx=7px/);
  const solution = [14, 8, -22];
  document
    .querySelectorAll<HTMLInputElement>("#tf-puzzle-panel input")
    .forEach((control, index) => {
      control.value = String(solution[index]);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  stage.update(0.01);
  assert.match(
    monitor.recentMessages("/tf_static", 1)[0].msg,
    /tx=14px ty=8px yaw=-22°/,
    "The winning transform must be published before completion stops updates",
  );
  checkEmitted(stage);
});

test("behavior-tree RUN publishes selected behavior and movement", () => {
  const stage = load("behavior_tree");
  overlayButton(/RUN/).click();
  advance(stage);
  expectTopics("/cmd_vel");
  assert.ok(
    published.some((event) => event.topic !== "/cmd_vel"),
    "Behavior status is observable",
  );
  checkEmitted(stage);
});

for (const [id, secondTopic] of [
  ["racing", "/p2/cmd_vel"],
  ["robo_soccer", "/p2/cmd_vel"],
  ["tag_chase", "/p2/pose"],
] as const) {
  test(`${id}: switching to two players updates the graph and telemetry`, () => {
    const stage = load(id);
    assert.ok(!stage.ros2!.state!.topics.some((topic) => topic.name === secondTopic));
    overlayButton(/2P/).click();
    assert.ok(stage.ros2!.state!.topics.some((topic) => topic.name === secondTopic));
    advance(stage, 4);
    hold(stage, "arrowup");
    expectTopics(secondTopic);
    checkEmitted(stage);
    assertCommands();
    overlayButton(/1P/).click();
    assert.ok(!stage.ros2!.state!.topics.some((topic) => topic.name === secondTopic));
    assertCommands();
  });
}

test("baseball swing and pitch observations come from actual play", () => {
  const stage = load("robo_baseball");
  advance(stage, 1);
  hold(stage, "e", 0.05);
  expectTopics("/pitch/trajectory", "/bat/swing");
  checkEmitted(stage);
});

test("tennis serve makes the observed ball move", () => {
  const stage = load("robo_tennis");
  advance(stage, 1);
  hold(stage, "e", 0.05);
  advance(stage, 0.4);
  expectTopics("/tennis/ball/pose");
  const samples = published
    .filter((event) => event.topic === "/tennis/ball/pose")
    .map((event) => event.msg);
  assert.ok(new Set(samples).size > 1, "Served ball must change position");
  checkEmitted(stage);
});

test("swarm publishes observable map, lost robots and current rescue state", () => {
  const stage = load("swarm_rescue");
  hold(stage, "w");
  expectTopics("/swarm/status", "/map", "/lost_bot_locations");
  checkEmitted(stage);
});

test("a one-off recovery event survives frequent publications on unrelated topics", () => {
  const stage = load("localization_mission");
  overlayButton(/GLOBAL RELOCALIZE/).click();
  const event = monitor.recentMessages("/localization/events", 1)[0];
  assert.ok(event);
  advance(stage, 1.5);
  assert.ok(published.length > 15, "Real periodic telemetry must fill the compact monitor");
  assert.equal(monitor.recentMessages(undefined, 100).length, 14);
  assert.ok(
    !monitor.recentMessages(undefined, 100).includes(event),
    "Event has left the compact panel",
  );
  assert.deepEqual(monitor.recentMessages("/localization/events"), [event]);
  assert.ok(run("ros2 topic echo /localization/events").includes(event.msg));
  checkEmitted(stage);
});

test("topic history is bounded separately and clearing removes panel and per-topic entries", () => {
  load("delivery");
  for (let index = 0; index < 35; index++)
    monitor.publish("/robot/manual_control/cmd_vel", `sample:${index}`);
  const entries = monitor.recentMessages("/robot/manual_control/cmd_vel", 100);
  assert.equal(entries.length, 30);
  assert.equal(entries[0].msg, "sample:5");
  assert.equal(entries.at(-1)!.msg, "sample:34");
  assert.equal(monitor.recentMessages(undefined, 100).length, 14);
  monitor.clearLog();
  assert.deepEqual(monitor.recentMessages(undefined, 100), []);
  assert.deepEqual(monitor.recentMessages("/robot/manual_control/cmd_vel", 100), []);
  assert.doesNotMatch(run("ros2 topic echo /robot/manual_control/cmd_vel").join("\n"), /sample:/);
});

test("real Retry clears prior service results and shell history before a new run", () => {
  const stage = load("service_builder");
  connectBuilder();
  advance(stage);
  overlayButton(/CALL/).click();
  overlayButton(/CALL/).click();
  const oldEvents = monitor.recentMessages("/service/events", 10);
  assert.equal(oldEvents.length, 2);
  assert.ok(run("ros2 topic echo /service/events").includes(oldEvents[1].msg));
  terminal.openPadPalette();
  ui.terminalInput.value = "unfinished input";
  manager.resetCurrent();
  assert.deepEqual(monitor.recentMessages(undefined, 100), []);
  assert.deepEqual(monitor.recentMessages("/service/events", 100), []);
  assert.equal(ui.terminalBody.querySelectorAll(".tline-out, .tline-cmd").length, 0);
  assert.equal(ui.terminalInput.value, "");
  assert.equal(terminal.isPadPaletteOpen(), false);
  ui.terminalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.equal(ui.terminalInput.value, "", "Previous commands are absent from history");
  assert.ok(!run("ros2 topic echo /service/events").includes(oldEvents[1].msg));
  published = [];
  connectBuilder();
  advance(stage);
  overlayButton(/CALL/).click();
  const newEvents = monitor.recentMessages("/service/events", 100);
  assert.equal(newEvents.length, 1, "Only the new request is retained after Retry");
  assert.ok(!run("ros2 topic echo /service/events").includes(oldEvents[1].msg));
  checkEmitted(stage);
});

test("Run refreshes a selected command if a two-player topic has disappeared", () => {
  load("racing");
  overlayButton(/2P/).click();
  const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
  select.dispatchEvent(new Event("focus"));
  select.value = "ros2 topic echo /p2/cmd_vel";
  assert.equal(select.value, "ros2 topic echo /p2/cmd_vel");
  overlayButton(/1P/).click();
  const count = ui.terminalBody.children.length;
  (document.getElementById("terminal-command-run") as HTMLButtonElement).click();
  assert.equal(ui.terminalBody.children.length, count, "Run must not execute the removed resource");
  assert.ok([...select.options].every((option) => !option.value.includes("/p2/")));
  select.value = "ros2 topic list";
  (document.getElementById("terminal-command-run") as HTMLButtonElement).click();
  assert.ok(ui.terminalBody.children.length > count, "Valid selections remain executable");
});

test("mode change clears previous telemetry, shell history and an open gamepad palette", () => {
  const stage = load("racing");
  overlayButton(/2P/).click();
  advance(stage, 4);
  hold(stage, "arrowup");
  assert.ok(monitor.recentMessages("/p2/cmd_vel").length > 0);
  run("ros2 topic echo /p2/cmd_vel");
  terminal.openPadPalette();
  const palette = document.getElementById("terminal-pad-palette")!;
  const index = commands.inspectionCommands(current!.ros2).indexOf("ros2 topic echo /p2/cmd_vel");
  assert.ok(index >= 0);
  terminal.paletteMove(index);
  assert.match(
    palette.querySelectorAll("div")[index].textContent!,
    /^▶ ros2 topic echo \/p2\/cmd_vel/,
  );
  overlayButton(/1P/).click();
  assert.equal(terminal.isPadPaletteOpen(), false);
  assert.deepEqual(monitor.recentMessages("/p2/cmd_vel", 100), []);
  assert.equal(ui.terminalBody.querySelectorAll(".tline-out, .tline-cmd").length, 0);
  ui.terminalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.equal(ui.terminalInput.value, "");
  const count = ui.terminalBody.children.length;
  terminal.paletteExec();
  assert.equal(ui.terminalBody.children.length, count, "A must not execute the removed resource");
  terminal.openPadPalette();
  assert.doesNotMatch(document.getElementById("terminal-pad-palette")!.textContent!, /\/p2\//);
  terminal.paletteMove(1);
  terminal.paletteExec();
  assert.ok(ui.terminalBody.children.length > count, "Refreshed palette remains operable");
});

for (const id of ["sumo_battle", "robo_tennis"] as const) {
  test(`${id}: player and difficulty changes clear prior run logs and terminal state`, () => {
    const stage = load(id);
    for (const choice of [/2P/, /1P/, /HARD/i]) {
      advance(stage, 0.4);
      assert.ok(monitor.recentMessages().length > 0, "The game must publish before changing setup");
      const oldTopics = new Set(published.map((event) => event.topic));
      run("ros2 topic list");
      terminal.openPadPalette();
      ui.terminalInput.value = "unfinished command";
      overlayButton(choice).click();
      assert.deepEqual(monitor.recentMessages(), []);
      for (const topic of oldTopics) assert.deepEqual(monitor.recentMessages(topic), []);
      assert.equal(ui.terminalBody.querySelectorAll(".tline-out, .tline-cmd").length, 0);
      assert.equal(ui.terminalInput.value, "");
      assert.equal(terminal.isPadPaletteOpen(), false);
      ui.terminalInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
      assert.equal(ui.terminalInput.value, "", "Previous commands must not survive a setup reset");
    }
  });
}

test("inspection controls revalidate a live graph change even without a stage reset", () => {
  const stage = load("delivery");
  const command = "ros2 topic echo /robot/manual_control/cmd_vel";
  const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
  select.dispatchEvent(new Event("focus"));
  select.value = command;
  terminal.openPadPalette();
  terminal.paletteMove(commands.inspectionCommands(stage.ros2).indexOf(command));
  // Model a runtime resource disappearing while both inspection controls are open.
  stage.ros2!.state = { ...stage.ros2!.state!, topics: [] };
  const count = ui.terminalBody.children.length;
  (document.getElementById("terminal-command-run") as HTMLButtonElement).click();
  terminal.paletteExec();
  assert.equal(ui.terminalBody.children.length, count);
  assert.ok([...select.options].every((option) => option.value !== command));
  assert.doesNotMatch(document.getElementById("terminal-pad-palette")!.textContent!, /topic echo/);
});
