// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { setupBlockProgram } from "../src/lib/block_program.ts";
import { setLang, t } from "../src/i18n/index.ts";
import { guideCopyFor } from "../src/guide/content.ts";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let context: GameContext;
let current: Stage | undefined;
let makeParamTuner: () => Stage;
let makeLidarAvoidance: () => Stage;
let makeFeedforwardMission: () => Stage;
let makeFeedbackMission: () => Stage;
let makeFeedforwardController: () => Stage;
let makeFeedbackController: () => Stage;
let makeTfPuzzle: () => Stage;
let clearResults: Array<{ stars: number; stats: string }>;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Event"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  makeParamTuner = (await import("../src/stages/lesson/param_tuner.ts")).makeParamTuner;
  makeLidarAvoidance = (await import("../src/stages/lesson/lidar_avoidance.ts")).makeLidarAvoidance;
  makeFeedforwardMission = (await import("../src/stages/lesson/feedforward_mission.ts"))
    .makeFeedforwardMission;
  makeFeedbackMission = (await import("../src/stages/lesson/feedback_mission.ts"))
    .makeFeedbackMission;
  makeFeedforwardController = (await import("../src/stages/lesson/feedforward_controller.ts"))
    .makeFeedforwardController;
  makeFeedbackController = (await import("../src/stages/lesson/feedback_controller.ts"))
    .makeFeedbackController;
  makeTfPuzzle = (await import("../src/stages/lesson/tf_puzzle.ts")).makeTfPuzzle;
});

beforeEach(() => {
  document.body.innerHTML = `
    <canvas width="800" height="500"></canvas><div id="overlay"></div>
    <div id="block-editor">
      <div class="be-palette"><p id="be-palette-hint"></p></div>
      <ol id="be-program"></ol><p id="be-status"></p><p id="be-program-hint"></p>
      <div class="be-actions">
        <button id="be-run"></button><button id="be-stop"></button><button id="be-clear"></button>
      </div>
    </div>`;
  setLang("en");
  clearResults = [];
  const noop = () => {};
  context = {
    canvas: document.querySelector("canvas")!,
    ctx: {},
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: noop,
    setHud: noop,
    publish: noop,
    shake: noop,
    getBestTime: () => null,
    setTimeout: (callback: () => void) => callback(),
    showClear: (stars: number, stats: string) => clearResults.push({ stars, stats }),
    sfx: new Proxy({}, { get: () => noop }),
    ghost: new Proxy({}, { get: () => noop }),
  } as unknown as GameContext;
});

afterEach(() => {
  current?.dispose();
  current = undefined;
});

after(async () => {
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function click(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector);
  assert.ok(button, `Missing button: ${selector}`);
  button.click();
}

function load(make: () => Stage): Stage {
  current = make();
  current.init(context);
  return current;
}

function setParameter(index: number, key: string, value: number): void {
  const input = document.getElementById(`be-param-${index}-${key}`) as HTMLInputElement;
  assert.ok(input, `Missing parameter: ${index} ${key}`);
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

for (const [operation, selector, expectedValues] of [
  ["add", ".be-palette-block", [1, 2, 3]],
  ["remove", ".be-remove", [2]],
  ["move up", "#be-program > li:nth-child(2) .be-up", [2, 1]],
  ["move down", ".be-down", [2, 1]],
  ["clear", "#be-clear", []],
] as const) {
  test(`structural ${operation} stops execution before changing the program`, () => {
    const program = [
      { kind: "drive", speed: 1 },
      { kind: "drive", speed: 2 },
    ];
    let running = true;
    let stops = 0;
    setupBlockProgram({
      program,
      blockKinds: [
        {
          kind: "drive",
          label: "drive",
          args: "speed",
          defaults: () => ({ kind: "drive", speed: 3 }),
          params: (block) => [{ key: "speed", value: block.speed }],
        },
      ],
      isRunning: () => running,
      onStop: () => {
        assert.deepEqual(
          program.map((block) => block.speed),
          [1, 2],
        );
        running = false;
        stops++;
      },
    });
    click(selector);
    assert.equal(stops, 1);
    assert.equal(running, false);
    assert.deepEqual(
      program.map((block) => block.speed),
      expectedValues,
    );
  });
}

test("numeric inputs and step buttons keep a live run active", () => {
  const program = [{ kind: "drive", speed: 1 }];
  let stops = 0;
  setupBlockProgram({
    program,
    blockKinds: [
      {
        kind: "drive",
        label: "drive",
        args: "speed",
        defaults: () => ({ kind: "drive", speed: 1 }),
        params: (block) => [{ key: "speed", value: block.speed, step: 0.1 }],
      },
    ],
    isRunning: () => true,
    onStop: () => stops++,
  });
  setParameter(0, "speed", 0.5);
  click(".be-param-step:last-child");
  assert.equal(program[0].speed, 0.6);
  assert.equal(stops, 0);
});

test("live image pipelines can keep evaluating after structural edits", () => {
  const program = [{ kind: "filter" }];
  let stops = 0;
  setupBlockProgram({
    program,
    blockKinds: [
      {
        kind: "filter",
        label: "filter",
        args: "",
        defaults: () => ({ kind: "filter" }),
        params: () => [],
      },
    ],
    isRunning: () => true,
    liveStructureEditing: true,
    onStop: () => stops++,
  });
  click(".be-palette-block");
  assert.equal(program.length, 2);
  click(".be-remove");
  assert.equal(program.length, 1);
  assert.equal(stops, 0);
});

function setupFocusProgram() {
  const program = [1, 2, 3, 4].map((speed) => ({ kind: "drive", speed }));
  const handle = setupBlockProgram({
    program,
    blockKinds: [
      {
        kind: "drive",
        label: "drive",
        args: "speed",
        defaults: () => ({ kind: "drive", speed: 1 }),
        params: (block) => [{ key: "speed", value: block.speed }],
      },
    ],
  });
  return { program, handle };
}

function focusAndClick(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector)!;
  button.focus();
  button.click();
}

test("reordering follows the moved block and chooses an enabled action at either boundary", () => {
  const { program } = setupFocusProgram();
  focusAndClick("#be-program > li:nth-child(3) .be-up");
  assert.deepEqual(
    program.map((block) => block.speed),
    [1, 3, 2, 4],
  );
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:nth-child(2) .be-up"),
  );
  (document.activeElement as HTMLButtonElement).click();
  assert.deepEqual(
    program.map((block) => block.speed),
    [3, 1, 2, 4],
  );
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:first-child .be-down"),
  );
  focusAndClick("#be-program > li:nth-child(2) .be-down");
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:nth-child(3) .be-down"),
  );
  (document.activeElement as HTMLButtonElement).click();
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:last-child .be-up"),
  );
  assert.equal((document.querySelector(".be-up") as HTMLButtonElement).disabled, true);
  assert.equal(
    (document.querySelector("#be-program > li:last-child .be-down") as HTMLButtonElement).disabled,
    true,
  );
});

test("deleting focuses the next row, then the preceding row, then a visible palette block", () => {
  const { program } = setupFocusProgram();
  const hiddenPalette = document.createElement("button");
  hiddenPalette.className = "be-palette-block";
  hiddenPalette.style.display = "none";
  document.querySelector(".be-palette")!.prepend(hiddenPalette);
  focusAndClick("#be-program > li:nth-child(3) .be-remove");
  assert.deepEqual(
    program.map((block) => block.speed),
    [1, 2, 4],
  );
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:nth-child(3) .be-remove"),
  );
  (document.activeElement as HTMLButtonElement).click();
  assert.deepEqual(
    program.map((block) => block.speed),
    [1, 2],
  );
  assert.equal(
    document.activeElement,
    document.querySelector("#be-program > li:nth-child(2) .be-remove"),
  );
  (document.activeElement as HTMLButtonElement).click();
  assert.equal(document.activeElement, document.querySelector(".be-remove"));
  (document.activeElement as HTMLButtonElement).click();
  assert.equal(program.length, 0);
  assert.equal(
    document.activeElement,
    document.querySelector('.be-palette-block[data-add="drive"]'),
  );
});

test("numeric edits and refreshes do not move focus away from unrelated controls", () => {
  const { handle } = setupFocusProgram();
  const input = document.getElementById("be-param-1-speed")!;
  input.focus();
  setParameter(1, "speed", 1.5);
  assert.equal(document.activeElement, input);
  const run = document.getElementById("be-run")!;
  run.focus();
  handle.refresh();
  assert.equal(document.activeElement, run);
  click(".be-remove");
  assert.equal(
    document.activeElement,
    run,
    "Programmatic row actions must not steal outside focus",
  );
});

test("stopping a live run before deletion still restores focus after both refreshes", () => {
  load(makeParamTuner);
  click("#be-run");
  focusAndClick(".be-remove");
  assert.equal(document.getElementById("be-status")!.textContent, "stopped");
  assert.equal(
    document.activeElement,
    document.querySelector('.be-palette-block[data-add="drive_params"]'),
  );
});

test("empty-program instructions are translated DOM outside the selectable program rows", () => {
  const { handle } = setupFocusProgram();
  click("#be-clear");
  const empty = document.getElementById("be-program-empty")!;
  assert.equal(empty.hidden, false);
  assert.equal(document.querySelectorAll("#be-program > li").length, 0);
  assert.equal(empty.previousElementSibling, document.getElementById("be-program"));
  assert.match(empty.textContent!, /Add a block from BLOCKS/);
  assert.doesNotMatch(empty.textContent!, /left|←/i);
  setLang("ja");
  handle.refresh();
  assert.match(empty.textContent!, /BLOCKSからブロックを追加/);
  assert.doesNotMatch(empty.textContent!, /左|←/);
  click(".be-palette-block");
  assert.equal(empty.hidden, true);
  handle.dispose();
  assert.equal(document.getElementById("be-program-empty"), null);
});

for (const language of ["ja", "en"] as const) {
  test(`${language}: L9 rejects a second block without interrupting live tuning`, () => {
    setLang(language);
    let status = "";
    context.setStatus = (message) => {
      status = message;
    };
    const stage = load(makeLidarAvoidance);
    setParameter(0, "threshold", 1.2);
    click("#be-run");
    click('.be-palette-block[data-add="lidar_avoid"]');
    assert.equal(document.querySelectorAll("#be-program > li").length, 1);
    assert.equal(
      (document.getElementById("be-param-0-threshold") as HTMLInputElement).value,
      "1.2",
    );
    assert.match(status, language === "ja" ? /1つだけ/ : /one lidar_avoid block/);
    stage.update(0.11);
    assert.ok(document.getElementById("be-status")!.classList.contains("running"));
    const topic = stage.ros2!.state!.topics.find(
      (entry) => entry.type === "sensor_msgs/msg/LaserScan",
    )!.name;
    assert.equal(topic, "/robot/lidar/scan");
    assert.ok(document.getElementById("be-palette-hint")!.textContent!.includes(topic));
    assert.ok(t("lidar_avoidance.lesson.learn").includes(topic));
    assert.ok(guideCopyFor(stage).overview.includes(topic));
  });

  for (const name of ["L5", "L7"] as const) {
    test(`${language}: ${name} localizes the triangle and practice mode controls`, () => {
      setLang(language);
      let hud: string[] = [];
      context.setHud = (lines) => {
        hud = lines;
      };
      const stage = load(name === "L5" ? makeFeedforwardController : makeFeedbackController);
      const toggle = document.getElementById("be-practice") as HTMLButtonElement;
      assert.ok(toggle);
      assert.match(
        toggle.textContent!,
        language === "ja" ? /三角形チャレンジ/ : /Triangle challenge/,
      );
      assert.match(toggle.title, /1\.4/);
      if (language === "en") assert.doesNotMatch(toggle.title, /[ぁ-んァ-ヶ一-龯]/);
      stage.update(0.01);
      assert.doesNotMatch(hud.join("\n"), /use fwd\/left\/right/);
      if (name === "L5")
        assert.match(hud[0], language === "ja" ? /三角形チャレンジ/ : /triangle challenge/);
      toggle.click();
      assert.match(toggle.textContent!, language === "ja" ? /練習モード/ : /Practice/);
      if (language === "en") assert.doesNotMatch(toggle.title, /[ぁ-んァ-ヶ一-龯]/);
      if (name === "L7") {
        assert.ok(toggle.title.includes("/robot/odometry/odometry"));
        assert.ok(guideCopyFor(stage).overview.includes("/robot/odometry/odometry"));
      }
    });
  }

  test(`${language}: TF HUD explains the sensor alignment in the selected language`, () => {
    setLang(language);
    let hud: string[] = [];
    context.setHud = (lines) => {
      hud = lines;
    };
    const stage = load(makeTfPuzzle);
    stage.update(0.2);
    const hint = hud.find((line) => line.startsWith("hint:"))!;
    assert.ok(hint);
    assert.match(hint, language === "ja" ? /青いLiDAR/ : /blue LiDAR/);
    if (language === "en") assert.doesNotMatch(hint, /[ぁ-んァ-ヶ一-龯]/);
  });
}

for (const name of ["L4", "L9"] as const) {
  test(`${name} safely removes its last running block and can start again`, () => {
    const stage = load(name === "L4" ? makeParamTuner : makeLidarAvoidance);
    click("#be-run");
    stage.update(0.11);
    const key = name === "L4" ? "max_speed" : "threshold";
    setParameter(0, key, name === "L4" ? 0.5 : 1.2);
    stage.update(0.11);
    assert.ok(document.getElementById("be-status")!.classList.contains("running"));
    click(".be-remove");
    assert.equal(document.querySelectorAll("#be-program > li").length, 0);
    assert.equal(document.getElementById("be-status")!.textContent, "stopped");
    assert.doesNotThrow(() => stage.update(0.2));
    click("#be-run");
    assert.doesNotThrow(() => stage.update(0.2));
    click(".be-palette-block");
    click("#be-run");
    stage.update(0.11);
    assert.ok(document.getElementById("be-status")!.classList.contains("running"));
  });
}

function setupMission(name: "L6" | "L8"): Stage {
  const stage = load(name === "L6" ? makeFeedforwardMission : makeFeedbackMission);
  click("#be-clear");
  const blocks =
    name === "L6"
      ? [
          ...Array.from({ length: 6 }, () => ({
            kind: "cmd_vel",
            linear: 0,
            angular: 0,
            duration: 0,
          })),
          { kind: "cmd_vel", linear: 1, angular: 0, duration: 6.4 },
          { kind: "cmd_vel", linear: 0, angular: -Math.PI / 2, duration: 1 },
          { kind: "cmd_vel", linear: 1, angular: 0, duration: 3.4 },
        ]
      : [
          ...Array.from({ length: 4 }, () => ({ kind: "go_straight", distance: 0, velocity: 1 })),
          { kind: "go_straight", distance: 6.4, velocity: 1 },
          { kind: "turn_right", angle: 90, yawrate: Math.PI / 2 },
          { kind: "go_straight", distance: 3.4, velocity: 1 },
        ];
  blocks.forEach((block, index) => {
    click(`.be-palette-block[data-add="${block.kind}"]`);
    for (const [key, value] of Object.entries(block))
      if (typeof value === "number") setParameter(index, key, value);
  });
  return stage;
}

for (const name of ["L6", "L8"] as const) {
  test(`${name} scores the executed program's block count`, () => {
    const stage = setupMission(name);
    click("#be-run");
    for (let frame = 0; frame < 3000 && clearResults.length === 0; frame++) stage.update(0.01);
    assert.equal(clearResults.length, 1);
    assert.equal(clearResults[0].stars, 1);
    assert.match(clearResults[0].stats, new RegExp(`Blocks\\s*<b>${name === "L6" ? 9 : 7}</b>`));
  });

  test(`${name} cannot gain stars by deleting blocks during execution`, () => {
    const stage = setupMission(name);
    click("#be-run");
    stage.update(0.01);
    while (document.querySelector(".be-remove")) click(".be-remove");
    for (let frame = 0; frame < 1500; frame++) stage.update(0.01);
    assert.equal(document.getElementById("be-status")!.textContent, "aborted");
    assert.equal(clearResults.length, 0);
  });
}
