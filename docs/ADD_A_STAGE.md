# Adding a New Game or Lesson

Each stage has a TypeScript entry point in `src/stages/game/` or `src/stages/lesson/`.
Keep reusable controls, simulation logic, and learning models in `src/lib/`.

The playable app reads generated stage listings and uses Vite's lazy `import.meta.glob` to
load the selected stage. Each file's `defineStage()` manifest registers its mode, display order,
translations, lesson modal, and diagram when that module loads. Catalog generation and all-stage
tests use `stage_collect.ts` to import every stage. The Guide reads a separate metadata catalog
containing descriptions and diagrams without loading playable stages or model weights.

## Workflow

1. Create a stage file and implement a factory that returns a `Stage`.
2. Default-export `defineStage()` with a unique order within its mode and Japanese/English content.
3. Add Japanese display labels in `src/core/stage_labels.ts`.
4. Describe the stage's actual simulated ROS graph and publish observable events.
5. Add Guide explanations, diagrams, and animations appropriate to the stage.
6. Run `npm run gen:stages` and `npm run gen:guide` to refresh the README tables and both catalogs, and update affected test expectations.
7. Verify formatting, tests, the build, and browser controls.

You do not need to add the stage ID to `main.ts`, `core/modes.ts`, or the shared i18n
dictionaries for automatic registration. Specialized controls or layouts may need integration
with their shared helpers, as described below.

## 1. Create the file

Place the entry point directly in the directory that matches its purpose:

```text
src/stages/game/treasure_rush.ts
src/stages/lesson/pid_tuning.ts
```

- Game: introduces a concept through play or a mission.
- Lesson: explains a concept through interaction, comparison, construction, or observation.
- The filename and `Stage.id` must match and use lowercase snake_case. IDs must be unique.
- Keep helper files outside these directories: the README generator treats each `.ts` file as a stage.
- Do not nest stage entry points in subdirectories; the runtime glob recurses, but the README generator does not.

The README generator currently parses source text. Keep `id: "...",` followed by
`name: "...",` on the next line, using literal double-quoted strings. Keep `mode` and
`order` as literals in the `defineStage()` call as well.

## 2. Implement `Stage`

See [`src/types.ts`](../src/types.ts) for the complete types. The following factory and the
manifest in the next section belong in the same `treasure_rush.ts` file:

```ts
// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { H, W, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { t, tx } from "../../i18n";
import {
  clearBackground,
  drawHint,
  drawRobotBody,
  drawTimer,
  drawZone,
  fmtTwist,
} from "../../lib/draw";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { teleop } from "../../lib/teleop";

const START = { x: 100, y: 250, theta: 0 };
const GOAL = { x: 700, y: 250, r: 30 };
const SPEED = 180;
const RADIUS = 16;

export function makeTreasureRush(): Stage {
  let g!: GameContext;
  const robot = { ...START };
  let elapsed = 0;
  let publishElapsed = 0;
  let cleared = false;

  function reset(): void {
    Object.assign(robot, START);
    elapsed = 0;
    publishElapsed = 0;
    cleared = false;
    g.ghost.startRecording();
    g.setStatus(t("treasure_rush.status.start"));
  }

  function init(ctx: GameContext): void {
    g = ctx;
    reset();
  }

  function update(dt: number): void {
    if (cleared) return;
    elapsed += dt;

    const cmd = teleop(g.keys, { baseLin: SPEED, baseAng: 2.4 });
    robot.theta += cmd.ang * dt;
    robot.x = Math.max(
      RADIUS,
      Math.min(W - RADIUS, robot.x + Math.cos(robot.theta) * cmd.lin * dt),
    );
    robot.y = Math.max(
      RADIUS,
      Math.min(H - RADIUS, robot.y + Math.sin(robot.theta) * cmd.lin * dt),
    );

    publishElapsed += dt;
    if (publishElapsed >= 1 / 20) {
      publishElapsed = 0;
      // This example uses SPEED pixels per simulated meter.
      g.publish("/cmd_vel", fmtTwist(cmd.lin / SPEED, cmd.ang));
    }
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    const dx = robot.x - GOAL.x;
    const dy = robot.y - GOAL.y;
    if (dx * dx + dy * dy <= GOAL.r * GOAL.r) {
      cleared = true;
      g.awardStars(3, `Time <b>${elapsed.toFixed(2)} s</b>`, undefined, {
        timeSeconds: elapsed,
      });
    }
  }

  function draw(): void {
    const c = g.ctx;
    clearBackground(c);
    drawZone(c, GOAL, "#5eead4", tx("ゴール", "GOAL"), elapsed);
    g.ghost.draw(c, elapsed, elapsed);
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, 0, elapsed);
    c.restore();
    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("treasure_rush.hint"));
  }

  function dispose(): void {
    // This example has no stage-owned listeners, timers, or UI to release.
  }

  return {
    id: "treasure_rush",
    name: "Treasure Rush",
    lesson: "Publisher and cmd_vel",
    lessonCmd: "ros2 topic echo /cmd_vel",
    get ros2() {
      return defineRos2Concept({
        title: tx("Publisher — 速度指令を配信する", "Publisher — publish velocity commands"),
        summary: tx(
          "操作入力が速度指令に変わり、Topicへ配信される流れを観察します。",
          "Observe how control input becomes a velocity command published to a topic.",
        ),
        msgTypes: ["geometry_msgs/msg/Twist"],
        cli: ["ros2 topic echo /cmd_vel", "ros2 topic info /cmd_vel"],
        realWorld: "",
        state: state({
          nodes: ["/teleop", "/robot"],
          topics: [
            topic("/cmd_vel", "geometry_msgs/msg/Twist", {
              pub: ["/teleop"],
              sub: ["/robot"],
            }),
          ],
        }),
      });
    },
    init,
    update,
    draw,
    reset,
    dispose,
  };
}
```

### Lifecycle and cleanup

| Method       | Purpose                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `init(ctx)`  | Receives `GameContext`, mounts stage UI/listeners, and initializes the selected stage |
| `update(dt)` | Updates simulation state; `dt` is measured in seconds                                 |
| `draw()`     | Renders to the default 800 × 500 logical canvas                                       |
| `reset()`    | Restarts the current stage without duplicating UI or listeners                        |
| `dispose()`  | Releases stage-owned listeners, timers, animation handles, and UI                     |

`defineStage()` calls the factory during registration, before `init()`. Defer runtime DOM
setup, event registration, and work that needs `GameContext` until `init()`. Metadata must be
readable and serializable before initialization because the Guide generator evaluates it then.
Do not resolve manifest-owned `t()` strings in the factory before `defineStage()` registers them.

Stage instances are reused across visits. Save the context before calling `reset()` and make
`dispose()` safe even if the instance has not been initialized. Restore any changed canvas
dimensions, layout, language subscriptions, and global listeners when leaving a stage.

The shell pauses `update()` while a menu or lesson/help/completion dialog is open,
and while the page is inactive. Terminal controls and the command palette keep `update()`
running with stage inputs neutral. `draw()` can still run while paused, so keep simulation changes in `update()`.
Use `g.setTimeout()` for delayed stage actions; the shell cancels these callbacks on reset or
stage change. Set your own `cleared` flag before calling `g.awardStars()` to avoid repeated awards.

For a timed ranking, pass `{ timeSeconds: completedTime }` as the result options. Capture that
number when the attempt finishes, before any delayed callback, and include penalties if they
count toward the score. Only finite positive times are saved. Omit `timeSeconds` for score-only
results. `statsHtml` is presentation text and is never parsed to determine records, so labels
can be translated freely.

For a stage-owned Retry button or a player/difficulty change that restarts the run, call
`(g.resetStage ?? reset)()`. The runtime path also clears held inputs, pending stage callbacks,
topic history, and terminal state. The fallback supports standalone previews that omit
`resetStage`. Do not call it from `reset()` itself.

### Main `GameContext` APIs

| API                                                  | Purpose                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `g.canvas` / `g.ctx`                                 | Canvas and 2D rendering context                                                             |
| `g.keys`                                             | Read-only set of combined input keys; use lowercase names such as `w` and `arrowup`         |
| `g.overlay`                                          | Stage-owned HTML controls and editor area                                                   |
| `g.setStatus(text, color?)`                          | Updates the visible status message                                                          |
| `g.setHud(lines)`                                    | Updates the telemetry HUD                                                                   |
| `g.publish(topic, msg)`                              | Records simulated topic data for the monitor and learning terminal                          |
| `g.awardStars(stars, statsHtml, delayMs?, options?)` | Plays the clear sound and shows completion after a managed delay                            |
| `g.showClear(stars, statsHtml, options?)`            | Shows completion immediately; pass `{ record: false }` to skip saving time, ghost and stars |
| `g.setTimeout(callback, delayMs)`                    | Schedules a callback cancelled on reset or stage change                                     |
| `g.crash(reason?)`                                   | Triggers failure feedback and the runtime restart sequence                                  |
| `g.resetStage?.()`                                   | Restarts through the runtime, including telemetry and terminal cleanup                      |
| `g.shake()` / `g.sfx`                                | Shared visual and audio feedback                                                            |
| `g.ghost`                                            | Records, reads, and draws replay poses                                                      |
| `g.getBestTime(stageId?)`                            | Returns the best saved time for the specified or current stage                              |

## 3. Register the manifest and translations

Append this manifest to the example factory. Choose an unused positive numeric `order` within
the same mode; `100` is an example, not a reserved slot.

```ts
export default defineStage({
  mode: "game",
  order: 100,
  lessonModal: {
    title: { ja: "速度指令をTopicへ配信する", en: "Publish velocity commands to a topic" },
    learn: {
      ja: "操作入力が /cmd_vel のメッセージになる流れを観察します。",
      en: "Observe how your controls become messages on /cmd_vel.",
    },
    goal: { ja: "緑のリングまで移動しましょう。", en: "Drive to the green ring." },
    first: {
      ja: "WASD・矢印キー、または左スティックで移動します。",
      en: "Move with WASD, arrow keys, or the left stick.",
    },
  },
  strings: {
    ja: {
      "status.start": "緑のリングまで移動しましょう。",
      hint: "WASD / 矢印キー / 左スティックで移動・Rでリスタート",
    },
    en: {
      "status.start": "Drive to the green ring.",
      hint: "WASD / arrows / left stick to move · R to restart",
    },
  },
  build: makeTreasureRush,
});
```

- `mode`, `order`, and `build` are required. `lessonModal`, `diagram`, and `strings` are optional manifest fields.
- `mode` must match the parent directory. Orders must be unique within a mode; smaller values come first.
- Lesson numbers are derived from order. Put only concept text in `Stage.lesson`, without an `L<number>` prefix.
- `strings` keys are prefixed automatically: `status.start` becomes `treasure_rush.status.start`.
- `lessonModal` provides bilingual `title`, `learn`, `goal`, and `first` text for the in-game briefing.
- Add an optional `diagram` SVG string for the lesson modal and Guide Lesson details. Use stage-specific SVG IDs and a descriptive `aria-label`.
- Add `{ name, lesson }` Japanese labels under the new stage ID in [`src/core/stage_labels.ts`](../src/core/stage_labels.ts). Manifest strings do not populate these display labels.
- Use `t()` or `tx()` at render time, or getters for language-dependent metadata, so language changes do not leave cached text behind.

## 4. Describe the simulated ROS graph

The example's `ros2` metadata supplies descriptions and the graph inspected by the learning
terminal. Use [`src/lib/ros2_concept.ts`](../src/lib/ros2_concept.ts) for `defineRos2Concept()`,
`state()`, `topic()`, and `service()` helpers.

- Declare only nodes, topics, services, and actions that the stage actually models. Publisher/subscriber and service/action endpoints must refer to declared nodes.
- Every topic passed to `g.publish()` must exist in the current `ros2.state.topics`. Emit actual simulation values or events, including a final result before stopping updates.
- Expose a dynamic graph when wiring or player modes change. A getter can derive it from stage state without depending on an initialized `GameContext`.
- Parameters and lifecycle queries require explicit `Ros2State.parameters` and `Ros2State.lifecycle` values. The `state()` helper only accepts nodes, topics, services, and actions; extend its result or provide a typed state object for the extra fields.
- Keep Japanese and English descriptions consistent with what the learner can observe. `python` is author-only reference material and is excluded from the Guide catalog. `realWorld` is shown in Guide details when provided; neither field is displayed in the game UI.

The Guide, footer, command selector, and gamepad palette use the shared observation-command
rules in [`src/lib/terminal_commands.ts`](../src/lib/terminal_commands.ts). `lessonCmd` alone
does not determine the displayed recommendation. Put supported commands such as
`ros2 topic echo /cmd_vel`, `ros2 node info /teleop`, or `ros2 service type /toggle_lamp`
in `ros2.cli` only when the corresponding resource exists.

`topic echo` shows recorded message snapshots, and `topic hz` estimates frequency from recent
samples. Neither creates telemetry. Publishing, service calls, action goals, parameter writes,
and shell pipelines are not supported terminal operations. Stage controls perform the simulated
actions; the terminal observes their results. This app does not communicate with real ROS 2
systems or hardware.

## 5. Integrate the Guide

Run `npm run gen:guide` after editing stage metadata. It evaluates the manifests in Japanese
and English and writes two catalogs:

- [`src/guide/stages.generated.json`](../src/guide/stages.generated.json) contains `StageMeta`, mode, derived lesson number, and diagram. `lessonModal` belongs to the in-game briefing and is not copied into this catalog.
- [`src/core/stages.generated.json`](../src/core/stages.generated.json) contains only IDs, modes, ordering, and bilingual names and lesson labels. Runtime menus use it before stage implementations load.

[`src/guide/stages.ts`](../src/guide/stages.ts) exposes the catalog to the Guide. Do not import
playable stage factories, `stage_collect`, or model weights into Guide code. The Vite build
checks the Guide's entire dependency graph, including dynamic imports. It also checks that
the playable app's initial static dependencies exclude stage implementations and model weights;
load stages through `stage_catalog.ts` and the stage manager. Shared drawing helpers and
metadata-only types are suitable for Guide animations.

| File                                                    | What to add or update                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`src/guide/content.ts`](../src/guide/content.ts)       | Bilingual card actions, overview, learning goals, steps, exercise, and insight via `guideCopyFor()` / `cardPreviewFor()` |
| [`src/guide/card_demos.ts`](../src/guide/card_demos.ts) | Lightweight card animation; include new Lesson IDs in `LESSON_IDS` for Lesson styling                                    |
| [`src/core/lesson_demo.ts`](../src/core/lesson_demo.ts) | Game detail animation in `STAGE_DEMO`                                                                                    |
| Stage manifest's `diagram`                              | SVG shown in Lesson details                                                                                              |

Generic copy, diagrams, and animations are available as fallbacks. Check that they actually
explain the new activity; an unrelated driving animation is not sufficient for a new learning
lab. Verify both languages and the direct links: `/?direct=stage#<id>` opens the playable
stage, and `/guide/?stage=<id>` opens its Guide detail (relative to the app's deployment base).

`npm run dev` regenerates both catalogs through `predev`, and `npm run build` regenerates them
before type-checking and bundling. If the dev server is already running, run `npm run gen:guide`
again after metadata changes. `npm run check:guide` verifies both files. Do not hand-edit the
generated JSON.

## Input support and responsive controls

### Single-player movement

Use `teleop(g.keys, ...)` as in the example to share movement across keyboard `WASD` / arrow
keys, gamepad left stick / D-pad, and shared touch movement controls. Stages must not mutate
`g.keys` or duplicate the shell's input merging.

Custom keyboard listeners must respect `isStageInteractionBlocked()` and `ownsNativeKey()`
from [`src/lib/input_guard.ts`](../src/lib/input_guard.ts). Preserve native input editing and
button activation. If a stage needs direct gamepad buttons, use `readStageGamepads()` from
[`src/lib/stage_gamepads.ts`](../src/lib/stage_gamepads.ts); it masks dialog-consumed presses
until release so closing a menu cannot also trigger a stage action.

### Editors, settings panels, and touch

| Module                                                    | Purpose                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`src/lib/block_program.ts`](../src/lib/block_program.ts) | Block editing with shared controls                                        |
| [`src/lib/overlay_panel.ts`](../src/lib/overlay_panel.ts) | Sliders and choices; `placement: "dock"` places controls below the canvas |
| [`src/lib/overlaypad.ts`](../src/lib/overlaypad.ts)       | Register/unregister custom panels for gamepad navigation                  |
| [`src/lib/navpad.ts`](../src/lib/navpad.ts)               | Nav2 goal cursor and orientation input                                    |
| [`src/lib/armpad.ts`](../src/lib/armpad.ts)               | Arm controls                                                              |
| [`src/lib/touchpad.ts`](../src/lib/touchpad.ts)           | Shared touch layouts and stage-specific control selection                 |

Do not introduce mouse-only tasks. Keep the stage completable with keyboard and gamepad, and
provide suitable touch controls. Check any stage-ID-specific control selection when reusing a
specialized layout; the manifest does not activate every controller automatically.

Use `drawHint()` and `drawTimer()` from `lib/draw.ts` for common canvas text. They integrate
with [`src/lib/canvas_readout.ts`](../src/lib/canvas_readout.ts), which presents hints and times
as readable HTML on narrow screens. Keep essential instructions and experiment results in
readable HTML panels when they would become too small on the scaled canvas.

For experiment-style Lessons, [`src/lib/lab_completion.ts`](../src/lib/lab_completion.ts)
provides `mountLabCompletion()` and `mountLabWorkbench()`. These keep completion feedback
visible and group the scene with its controls. Save their returned cleanup functions and call
them in `dispose()` to restore the shared shell.

### Two-player games

Use [`src/lib/two_player.ts`](../src/lib/two_player.ts) for separate player inputs:

- Player 1: gamepad 1 or `WASD`; action with `A` / `X` on the pad or `E` / `Space` on the keyboard.
- Player 2: gamepad 2 or arrow keys; action with `A` / `X` on the pad or `Enter` on the keyboard.
- Boost: shoulder button or trigger; left `Shift` / `X` for Player 1 and right `Shift` for Player 2.

Call `setActive(true)` when entering two-player mode and `setActive(false)` when leaving it
or disposing the stage. Reset button-edge state on restart as in the reference games, and
update the observable graph when a second player is added or removed.

A two-player match is not a single-player run. Pass `{ record: false }` to `g.showClear()` or
`g.awardStars()` for its result so the match time, ghost and stars are not saved as Player 1's
record.

## Shared modules and reference stages

Reuse existing modules where they provide the required behavior:

| Module                                                                        | Purpose                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `lib/draw.ts`, `lib/hud.ts`                                                   | Shared drawing and pose, Twist, and time formatting                |
| `lib/walls.ts`, `lib/trail.ts`, `lib/particles.ts`                            | Collision checks, paths, and effects                               |
| `lib/start_drag.ts`                                                           | START movement for Feedforward / Feedback stages                   |
| `lib/camera_mission.ts`                                                       | Shared camera Lesson behavior                                      |
| `lib/arm.ts`                                                                  | Arm kinematics and rendering data                                  |
| `lib/imitation_data.ts`, `lib/imitation_model.ts`, `lib/imitation_visuals.ts` | Demonstration data, behavior-cloning model, and shared lab visuals |
| `lib/reinforcement_model.ts`                                                  | Reinforcement-learning simulation and policy                       |
| `lib/vla_model.ts`, `lib/world_model.ts`                                      | VLA and world-model inference / experiment logic                   |

| What you want to build                        | Reference implementation                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simple single-player Game                     | [`delivery.ts`](../src/stages/game/delivery.ts)                                                                                                        |
| Two-player Game                               | [`robo_soccer.ts`](../src/stages/game/robo_soccer.ts)                                                                                                  |
| Mapping Game                                  | [`treasure_map.ts`](../src/stages/game/treasure_map.ts)                                                                                                |
| Node-wiring Lesson                            | [`pubsub_builder.ts`](../src/stages/lesson/pubsub_builder.ts)                                                                                          |
| Block-editing Lesson                          | [`lidar_avoidance.ts`](../src/stages/lesson/lidar_avoidance.ts)                                                                                        |
| Feedforward / Feedback comparison             | [`feedforward_controller.ts`](../src/stages/lesson/feedforward_controller.ts), [`feedback_controller.ts`](../src/stages/lesson/feedback_controller.ts) |
| Live parameters and terminal state            | [`param_tuner.ts`](../src/stages/lesson/param_tuner.ts)                                                                                                |
| Image-processing Lesson                       | [`image_processing.ts`](../src/stages/lesson/image_processing.ts)                                                                                      |
| Arm Lesson                                    | [`joint_teleop.ts`](../src/stages/lesson/joint_teleop.ts)                                                                                              |
| Demonstration collection and behavior cloning | [`imitation_learning.ts`](../src/stages/lesson/imitation_learning.ts)                                                                                  |
| Reward design and policy evaluation           | [`reinforcement_learning.ts`](../src/stages/lesson/reinforcement_learning.ts)                                                                          |
| Image-and-language action selection           | [`vla_lab.ts`](../src/stages/lesson/vla_lab.ts)                                                                                                        |
| Learned prediction and planning               | [`world_model.ts`](../src/stages/lesson/world_model.ts)                                                                                                |

## Completion checklist

Use the Node.js version declared in `package.json` and install dependencies with `npm ci`.
After changing manifests, regenerate the README tables and both catalogs before running tests:

```bash
npm run gen:stages
npm run gen:guide
npm run format:check
npm test
npm run build
```

Format changed source files with Prettier when needed. `npm run format` formats all files
covered by the repository configuration, so review its diff before committing.

`npm test` runs the TypeScript tests plus `check:stages` and `check:guide`. The all-stage
terminal tests discover new stage files automatically and validate cold metadata, graph
endpoints, available commands, and emitted topics. Add focused behavior tests for new controls,
simulation logic, or learning models.

When adding or reordering stages, update catalog-count and numbering expectations in
[`tests/guide_ui.test.ts`](../tests/guide_ui.test.ts),
[`tests/stage_terminal_contracts.test.ts`](../tests/stage_terminal_contracts.test.ts), and
[`tests/world_completion.test.ts`](../tests/world_completion.test.ts) as appropriate.
Also update descriptive counts outside the generated README tables. Commit the regenerated
README tables, Guide JSON, and runtime stage-list JSON together with the stage changes.

CI currently runs `npm ci`, `node scripts/audit-check.mjs`, `npm run format:check`, `npm test`,
and `npm run build`. DOM tests do not validate rendered canvas pixels or
physical controller drivers, so start `npm run dev` and verify:

- Home, the stage picker, and Guide links open the intended Game or Lesson; next-stage navigation stays in the same mode.
- Resetting and changing stages clears stale input, telemetry, terminal history, callbacks, and stage-specific UI without duplicating listeners.
- Keyboard, gamepad, and applicable touch controls can complete the activity, including custom panels and editors.
- Help, menus, completion dialogs, and an inactive window pause the simulation. Terminal controls and the command palette keep it running with stage inputs neutral; releasing focus or refocusing the window does not replay a held action.
- Declared topics and terminal observations match real stage interactions, including final results and player-mode changes.
- Lesson briefings, Japanese display labels, Guide copy, diagrams, and animations explain the activity in both languages.
- Instructions, controls, results, and completion actions remain visible at narrow and wide widths (for example 375, 768, and 1280 px).

## How automatic registration works

| File                                                                | Responsibility                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`src/core/stage_catalog.ts`](../src/core/stage_catalog.ts)         | Registers lightweight listings and dynamic imports for runtime stage loading |
| [`src/core/stages.generated.json`](../src/core/stages.generated.json) | Supplies IDs, modes, ordering, and bilingual names and lesson labels for menus |
| [`src/core/stage_collect.ts`](../src/core/stage_collect.ts)         | Eagerly imports all playable modules for catalog generation and tests |
| [`src/core/stage_def.ts`](../src/core/stage_def.ts)                 | Registers stage loaders and loaded manifests, translations, and diagrams |
| [`src/core/modes.ts`](../src/core/modes.ts)                         | Builds the runtime Game / Lesson lists                             |
| [`scripts/gen-stage-list.mjs`](../scripts/gen-stage-list.mjs)       | Validates IDs/orders and generates the README stage tables         |
| [`scripts/gen-guide-catalog.mjs`](../scripts/gen-guide-catalog.mjs) | Evaluates manifests in both languages and generates both JSON catalogs |
| [`src/guide/stages.ts`](../src/guide/stages.ts)                     | Reads the generated catalog without loading playable stages        |

If a stage is missing from the playable app, check its `defineStage()` export, `mode`,
`order`, and filename/ID match. Run `npm run gen:guide` and verify its listing in
`src/core/stages.generated.json`. For missing or stale Guide content, verify the corresponding
entry in `src/guide/stages.generated.json`. Neither runtime entry point should import
`stage_collect.ts`; keep its eager imports in catalog generation and tests.
