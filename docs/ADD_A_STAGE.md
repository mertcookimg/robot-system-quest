# Adding a New Game or Lesson

In this project, each stage is generally implemented as a single TypeScript file.

Vite automatically collects `src/stages/**/*.ts` with `import.meta.glob`. The `defineStage()` call in each file registers the Game / Lesson list, display order, Japanese and English text, and diagrams used by the Guide.

## Workflow

1. Create a file in `src/stages/game/` or `src/stages/lesson/`.
2. Implement a factory function that returns a `Stage`.
3. Default-export `defineStage()`.
4. Add a custom Guide explanation or animation when needed.
5. Verify formatting, tests, the build, and browser controls.

You do not need to add the stage ID manually to `main.ts`, `core/modes.ts`, or the shared i18n dictionaries.

## 1. Create the file

Place the file in the directory that matches its purpose:

```text
src/stages/game/treasure_rush.ts
src/stages/lesson/pid_tuning.ts
```

The filename and `Stage.id` must match and use lowercase snake_case.

- Game: introduces a concept through play or a mission
- Lesson: explains a concept through interaction, comparison, construction, or observation

## 2. Implement `Stage`

See [`src/types.ts`](../src/types.ts) for the complete type definitions.

A minimal implementation looks like this:

```ts
import { H, W, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { t } from "../../i18n";
import { teleop } from "../../lib/teleop";

const START = { x: 100, y: 250, theta: 0 };
const GOAL = { x: 700, y: 250, r: 30 };

export function makeTreasureRush(): Stage {
  let g!: GameContext;
  const robot = { ...START };
  let elapsed = 0;
  let cleared = false;

  function reset(): void {
    Object.assign(robot, START);
    elapsed = 0;
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

    // g.keys combines keyboard and gamepad input.
    const cmd = teleop(g.keys, { baseLin: 180, baseAng: 2.4 });
    robot.theta += cmd.ang * dt;
    robot.x += Math.cos(robot.theta) * cmd.lin * dt;
    robot.y += Math.sin(robot.theta) * cmd.lin * dt;

    g.publish("/cmd_vel", `linear.x=${cmd.lin} angular.z=${cmd.ang}`);
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    const dx = robot.x - GOAL.x;
    const dy = robot.y - GOAL.y;
    if (dx * dx + dy * dy <= GOAL.r * GOAL.r) {
      cleared = true;
      g.awardStars(3, `Time <b>${elapsed.toFixed(2)} s</b>`);
    }
  }

  function draw(): void {
    const c = g.ctx;
    c.fillStyle = "#03060d";
    c.fillRect(0, 0, W, H);

    c.fillStyle = "#5eead4";
    c.beginPath();
    c.arc(GOAL.x, GOAL.y, GOAL.r, 0, Math.PI * 2);
    c.stroke();

    c.fillStyle = "#7dd3fc";
    c.beginPath();
    c.arc(robot.x, robot.y, 16, 0, Math.PI * 2);
    c.fill();
  }

  function dispose(): void {
    // Release event listeners, timers, and stage-specific UI here.
  }

  return {
    id: "treasure_rush",
    name: "Treasure Rush",
    lesson: "Publisher and cmd_vel",
    lessonCmd: "ros2 topic echo /cmd_vel",
    init,
    update,
    draw,
    reset,
    dispose,
  };
}
```

### `Stage` lifecycle

| Method | Purpose |
|---|---|
| `init(ctx)` | Initializes the selected stage and receives its `GameContext` |
| `update(dt)` | Updates state every frame; `dt` is measured in seconds |
| `draw()` | Renders to the 800 × 500 canvas |
| `reset()` | Restores the initial state on restart |
| `dispose()` | Releases events, timers, and stage-specific UI |

Because `init()` also calls `reset()`, save the `GameContext` before resetting the stage.

### Main `GameContext` APIs

| API | Purpose |
|---|---|
| `g.canvas` / `g.ctx` | Canvas and 2D rendering context |
| `g.keys` | Combined keyboard and gamepad input |
| `g.overlay` | Container for stage-specific HTML UI |
| `g.setStatus(text, color?)` | Updates the status display |
| `g.setHud(lines)` | Updates the Robot State display |
| `g.publish(topic, message)` | Simulates publishing to the Topic Monitor |
| `g.awardStars(stars, html, delay?)` | Shows the clear screen with a sound effect |
| `g.showClear(stars, html)` | Shows the clear screen |
| `g.crash(reason?)` | Plays the failure effect and resets the stage |
| `g.shake(intensity?)` | Shakes the screen |
| `g.sfx` | Sound effects |
| `g.ghost` | Best-run recording and playback |
| `g.getBestTime(stageId?)` | Reads a saved best time |

## 3. Add `defineStage()`

Default-export the stage manifest after the factory function:

```ts
export default defineStage({
  mode: "game",
  order: 13,
  diagram: `
    <svg viewBox="0 0 420 120" role="img" aria-label="Controller publishes cmd_vel to robot">
      <!-- Diagram displayed in the Guide and Lesson modal -->
    </svg>
  `,
  lessonModal: {
    title: {
      ja: "Publisherで速度指令を送る",
      en: "Send velocity commands with a Publisher",
    },
    learn: {
      ja: "操作入力をTwistメッセージへ変換し、topicへ送る流れを理解します。",
      en: "Understand how control input becomes a Twist message published to a topic.",
    },
    goal: {
      ja: "ロボットを操作してGOALへ移動します。",
      en: "Drive the robot to the goal.",
    },
    first: {
      ja: "WASDまたは左スティックで動かしてみましょう。",
      en: "Start by driving with WASD or the left stick.",
    },
  },
  strings: {
    ja: {
      "status.start": "GOALまでロボットを動かそう",
    },
    en: {
      "status.start": "Drive the robot to the goal",
    },
  },
  build: makeTreasureRush,
});
```

The Japanese strings in this example are intentional: every user-facing string must provide both `ja` and `en` translations.

### Manifest fields

| Field | Required | Description |
|---|---|---|
| `mode` | Yes | `"game"` or `"lesson"` |
| `order` | Yes | Display order within the selected mode |
| `build` | Yes | Factory function that returns a `Stage` |
| `lessonModal` | No | Bilingual title, learning objective, goal, and first action |
| `diagram` | No | SVG displayed in the Lesson modal and Guide details |
| `strings` | No | Japanese and English strings used by the stage |

The stage ID is automatically prepended to keys in `strings`. For example, the key above is accessed with `t("treasure_rush.status.start")`.

When a Lesson defines `lessonModal`, the modal opens automatically the first time the Lesson is selected. In a Game, it opens from the on-screen Guide button.

## Display ROS 2 information

Add `ros2` to the `Stage` to show information in the ROS 2 panel and simulated terminal at the bottom of the screen:

```ts
import { tx } from "../../i18n";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";

// Inside the object returned by makeTreasureRush()
ros2: defineRos2Concept({
  title: tx("Publisherとcmd_vel", "Publisher and cmd_vel"),
  summary: tx(
    "操作入力から速度指令を作り、topicへpublishする流れを観察します。",
    "Observe how control input becomes a velocity command published to a topic.",
  ),
  msgTypes: ["geometry_msgs/msg/Twist"],
  cli: [
    "ros2 topic list",
    "ros2 topic info /cmd_vel",
    "ros2 topic echo /cmd_vel",
  ],
  // Retained as Ros2Concept compatibility data, although the current UI does not display it.
  python: "",
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
}),
```

Register only nodes, topics, services, and safe observation commands that exist in the stage. Do not describe simulated ROS 2 communication as if it were communicating with real hardware.

## Guide integration

New stages are added automatically to the Game / Lesson lists in the Guide. The basic page is generated from the stage's `name`, `lesson`, `ros2`, `lessonModal`, and `diagram` data.

Update the following files when a stage needs a custom, publication-quality explanation or animation:

| File | Purpose |
|---|---|
| [`src/guide/content.ts`](../src/guide/content.ts) | Card text, detailed explanations, observation points, and bilingual copy |
| [`src/guide/card_demos.ts`](../src/guide/card_demos.ts) | Canvas animations for Guide cards |
| [`src/core/lesson_demo.ts`](../src/core/lesson_demo.ts) | Game demonstrations shown in Guide details |

A fallback view is displayed without custom data, but verify both Japanese and English content before publishing.

## Input support

### Single-player movement

Use `teleop(g.keys, ...)` to handle keyboard `WASD` / arrow keys, the gamepad left stick, and the D-pad through the same code path:

```ts
const cmd = teleop(g.keys, { baseLin: 180, baseAng: 2.4 });
```

Stages normally do not need to call `navigator.getGamepads()` directly.

### Editors and settings panels

- Block editing: [`src/lib/block_program.ts`](../src/lib/block_program.ts)
- HTML settings panels: [`src/lib/overlay_panel.ts`](../src/lib/overlay_panel.ts)
- Nav2 goal cursor: [`src/lib/navpad.ts`](../src/lib/navpad.ts)
- Arm controls: [`src/lib/armpad.ts`](../src/lib/armpad.ts)

Do not add mouse-only interfaces. The same task must also be completable with a keyboard and gamepad.

### Two-player games

Use [`src/lib/two_player.ts`](../src/lib/two_player.ts) for local two-player controls.

- Player 1: gamepad 1 or `WASD`
- Player 2: gamepad 2 or arrow keys
- Action: gamepad `X`; `E` for Player 1 and `Enter` for Player 2
- Boost: shoulder button or trigger; left `Shift` for Player 1 and right `Shift` for Player 2

Always call `setActive(true)` when the stage starts and `setActive(false)` in `dispose()`.

## Common shared modules

| Module | Purpose |
|---|---|
| `lib/draw.ts` | Draws robots, grids, zones, timers, and other shared elements |
| `lib/teleop.ts` | Calculates velocity commands from combined input |
| `lib/walls.ts` | Detects collisions between a circular robot and walls |
| `lib/trail.ts` | Records and draws paths |
| `lib/particles.ts` | Particle effects |
| `lib/hud.ts` | Formats pose, Twist, and time displays |
| `lib/ros2_concept.ts` | Typed builder for ROS 2 information |
| `lib/block_program.ts` | Block-programming UI |
| `lib/start_drag.ts` | START movement for Feedforward / Feedback stages |
| `lib/camera_mission.ts` | Shared camera Lesson behavior |
| `lib/arm.ts` | Arm kinematics and rendering data |

Reuse an existing shared module when it provides the required behavior instead of duplicating the implementation inside a stage.

## Reference stages

| What you want to build | Reference implementation |
|---|---|
| Simple single-player Game | [`delivery.ts`](../src/stages/game/delivery.ts) |
| Two-player Game | [`robo_soccer.ts`](../src/stages/game/robo_soccer.ts) |
| Mapping Game | [`treasure_map.ts`](../src/stages/game/treasure_map.ts) |
| Node-wiring Lesson | [`pubsub_builder.ts`](../src/stages/lesson/pubsub_builder.ts) |
| Block-editing Lesson | [`lidar_avoidance.ts`](../src/stages/lesson/lidar_avoidance.ts) |
| Feedforward / Feedback comparison | [`feedforward_controller.ts`](../src/stages/lesson/feedforward_controller.ts), [`feedback_controller.ts`](../src/stages/lesson/feedback_controller.ts) |
| Image-processing Lesson | [`image_processing.ts`](../src/stages/lesson/image_processing.ts) |
| Arm Lesson | [`joint_teleop.ts`](../src/stages/lesson/joint_teleop.ts) |

## Completion checklist

Run the following commands:

```bash
npm run format
npm run format:check
npm test
npm run build
npm run dev
```

At minimum, verify the following behavior in a browser:

- A Game or Lesson can be started from Home.
- Stage selection and transitions to the next stage work correctly.
- No state, UI, or event handlers remain after a reset.
- The stage can be completed with a keyboard.
- The stage can be completed with a gamepad.
- The Lesson modal and Guide explanations are readable in Japanese and English.
- The target Game or Lesson opens directly from the Guide.
- Essential controls remain visible at narrow screen widths.

Update the stage lists before committing:

```bash
npm run gen:stages
```

The final CI-equivalent checks are:

```bash
npm run format:check
npm test
npm run build
```

## How automatic registration works

- [`src/core/stage_collect.ts`](../src/core/stage_collect.ts) — eagerly imports `src/stages/**/*.ts`
- [`src/core/stage_def.ts`](../src/core/stage_def.ts) — registers manifests, i18n data, diagrams, and display order
- [`src/core/modes.ts`](../src/core/modes.ts) — generates the Game / Lesson lists from registered stages
- [`scripts/gen-stage-list.mjs`](../scripts/gen-stage-list.mjs) — generates the README tables from the manifests

If a new file does not appear, check the default export of `defineStage()`, its `mode` and `order`, and whether the factory's `id` matches the filename.
