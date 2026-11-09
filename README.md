# Robot System Quest: Games and Lessons

Robot System Quest: Games and Lessons is a browser-based learning experience for exploring ROS 2, robotic systems, and Physical AI foundations by controlling robots and running small experiments.

It visualizes concepts such as publishers, subscribers, services, actions, feedforward and feedback control, LiDAR, image processing, TF, SLAM, localization, Nav2, behavior trees, and manipulation through games and interactive lessons. Four mini labs introduce imitation learning, reinforcement learning, vision-language-action policies, and learned world models. It does not connect to a real ROS 2 environment or physical robot.

![Robot System Quest gameplay](docs/RSQ.gif)

- [YouTube](https://youtu.be/iXOOvXn6CYc)
- [Game and Lessons Site (English and Japanese)](https://mertcookimg.github.io/robot-system-quest/)
- [Guide Page (English and Japanese)](https://mertcookimg.github.io/robot-system-quest/guide/)

- **GAME** — 14 stages that introduce robotics concepts through delivery missions, racing, robot soccer, mapping, and more
- **LESSON** — 24 stages for experimenting with node wiring, block editing, parameter tuning, image processing, navigation, imitation learning, reinforcement learning, VLA, world models, and more
- **ROBOTICS LEARNING GUIDE** — Bilingual explanations of what to try and observe in each game and lesson
- **Keyboard / Gamepad / Touch** — Keyboard and gamepad support across all stages, plus controls designed for touch devices
- **Japanese / English** — Switch the interface language at any time
- **Client-side only** — Runs without a backend

> This project is a simplified simulation for learning ROS 2 concepts. It does not communicate with physical ROS 2 nodes or sensors.

## Run locally

You will need a modern browser and Node.js 24.22.1 or later within the 24.x line.
Local development, CI, and deployment builds all use Node.js 24.x. Both GitHub
Actions workflows read the version range from `engines.node` in `package.json`
and select the latest matching release. Keep your local Node.js 24.x updated too;
24.22.1 includes the October 21, 2026 security fixes.

```bash
npm ci
npm run dev
```

The development server uses these URLs by default:

- Home / Game / Lesson: <http://localhost:5173/>
- Robotics Learning Guide: <http://localhost:5173/guide/>

The Guide includes a Japanese/English video walkthrough of all 24 Lessons. Expand the chapter
list to play a lesson's segment, then open that Lesson directly to try it. Lesson cards and
detail pages also link to the corresponding YouTube timestamp. The player loads on request;
both editions use background music and captions without spoken narration.

`npm run dev` starts the development environment. To test the production build locally, run:

```bash
npm run build
npm run preview
```

The production files are written to `dist/`. Pushes to `main` are tested, built, and deployed
to GitHub Pages by the included workflow. The workflow derives the deployment subpath from the
repository name, so renamed forks do not need to edit `vite.config.ts`.

Analytics is disabled by default, including during local development and in forks. Repository
owners who want Google Analytics can define the Actions repository variable
`GA_MEASUREMENT_ID`; it is passed to production builds as `VITE_GA_ID`.

When enabled, analytics records aggregate stage starts, completions, resets, exits, play duration,
stars, Guide detail opens, Guide-to-stage clicks, and Guide section views. Events use only
predefined stage and section identifiers; user-entered text, simulated terminal commands, and
saved progress are not sent.

## npm scripts

| Command | Description |
|---|---|
| `npm run dev` | Regenerate Guide metadata and start the Vite development server |
| `npm run build` | Regenerate Guide metadata, type-check, and build both entry points in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run model, control, terminal, and DOM interaction tests; check generated stage lists and Guide metadata |
| `npm run format` | Format code and documentation with Prettier |
| `npm run format:check` | Check for formatting differences |
| `npm run gen:stages` | Update the README stage lists from the stage manifests |
| `npm run check:stages` | Check that the README stage lists are up to date |
| `npm run gen:guide` | Generate the bilingual Guide metadata from the stage manifests |
| `npm run check:guide` | Check that generated Guide metadata matches the current stages |

The Guide uses `src/guide/stages.generated.json` rather than importing playable stages.
`npm run dev` and `npm run build` regenerate this catalog automatically; after editing
a stage during development, run `npm run gen:guide` to refresh its Guide metadata.
The catalog includes descriptions, diagrams and ROS interface examples, with no stage
controllers or model weights. The production build checks this dependency boundary,
and `npm test` checks that the catalog is current. Edit the stage manifests rather than
the generated JSON.

## Controls

Most stages share the controls below. In block editors and puzzles, follow the on-screen instructions when they differ. Select `?` in the upper-right corner to open the control guide.

| Action | Keyboard | Gamepad |
|---|---|---|
| Move / turn | `WASD` / arrow keys | Left stick / D-pad |
| Boost | `Shift` / `X` | `LB` / `RB` / `LT` / `RT` |
| Emergency stop | `Space` | `A` during normal driving |
| Reset | `R` | `Start` |
| Help | `?` / `/` | `R3` |
| Select a stage | On-screen GAME / LESSON controls | `Select` |
| Simulated ROS 2 commands | Terminal at the bottom of the screen | Press `L3` to open the command palette |
| Confirm / close | `Enter` / `Space` / `Esc` | `A` / `B` |
| Return from the terminal | `Esc` or **Back to stage** | `B`; `L3` also closes the command palette |

Gamepad API button numbers and names may differ by browser, operating system, and controller.

Menus, help, completion dialogs and terminal interaction pause the simulation. Returning to
the stage resumes it; leaving the window releases held inputs. On small screens, shared
canvas hints and timing appear as readable, wrapping text below the scene.

In the stage picker, use arrow keys or `Tab` / `Shift+Tab` to move focus and `Enter` / `Space`
to confirm the focused control. Clicking the other GAME / LESSON tab switches the open list;
clicking the selected tab closes it. The running stage changes only after choosing a card.
Restarting from the all-clear screen returns to Delivery and the GAME list.

After a collision that opens the failure screen, the stage restarts automatically after about
1.3 seconds. `Esc`, gamepad `B`, or the touch close control starts the next attempt immediately.
In the mini labs, dismissing the completion dialog keeps the completed results available for
review; restarting begins another experiment.

Object Detection shows classes, confidence, velocity, and simulated processing time as HTML
text, with numbered boxes in the camera image and expandable detection JSON. On small screens,
these results sit below the scene. Behavior Tree and TF use larger text and controls; Behavior
Tree labels each condition and action separately.

### Simulated ROS 2 terminal

All 24 lessons and 14 games expose their simulated nodes, topics and available services or
actions in the terminal. The guide, command selector and gamepad palette use the same stage
definitions. Player-dependent graphs follow the current one-player or two-player mode.
Use `ros2 topic list -t`, `ros2 node list`, `ros2 topic info <topic>` or
`ros2 topic echo <topic>` in the terminal, command selector, or gamepad palette.
When finished, use **Back to stage**, `Esc`, or gamepad `B` to return focus and control to the
robot without resetting it. `L3` toggles the gamepad command palette.

L21–L24 expose their actual lesson events through `std_msgs/msg/String` diagnostic topics:

| Lesson | Simulated node | Topics |
|---|---|---|
| L21 Imitation Learning Mini Lab | `/imitation_lab` | `/imitation/data`, `/imitation/training`, `/imitation/evaluation` |
| L22 Reinforcement Learning Mini Lab | `/rl_lab` | `/learning`, `/rl/evaluation` |
| L23 VLA Mini Lab | `/vla_policy` | `/vla/action` |
| L24 World Model Mini Lab | `/world_model_planner` | `/world_model/trial`, `/world_model/result` |

Operate the stage to generate events. `echo` shows a snapshot of the latest saved messages;
run it again to refresh. The monitor displays the latest 14 messages across topics; terminal
queries retain up to 30 messages per topic. Changing stages or restarting clears both histories.
These are compact browser logs, not complete serialized ROS messages or a
connection to ROS 2 processes or hardware. Service and action events use separate diagnostic
topics; service endpoints and action results are not presented as ordinary topics.
Parameter and lifecycle queries report only state explicitly modeled by the current stage.
The terminal does not train models or change stage settings: unsupported publishing, service
calls, action goals and parameter writes are reported as unavailable. See the
[terminal review](docs/LEARNING_TERMINAL_REVIEW.md) for the checks performed.

### Local two-player games

The following games support competitive play with two gamepads:

- Racing
- Robo Soccer
- Tag Chase
- Sumo Battle
- Robo Tennis

On a keyboard, Player 1 uses `WASD` and Player 2 uses the arrow keys. Player 1's action key is `E`, and Player 2's is `Enter`. Player 1 boosts with left `Shift`, and Player 2 boosts with right `Shift`.

## Technology

- **Vite** — Development server and multi-page production build
- **TypeScript** — Strict mode with `noEmit`
- **Canvas 2D** — Rendering and animation for games and lessons
- **Web Audio API** — Sound effects generated at runtime
- **Gamepad API** — Single-player controls and local two-player games
- **localStorage** — Persists language, progress, stars, best times, and other settings
- **Node.js Test Runner + tsx** — Automated tests for models, control logic, and simulated ROS contracts
- **happy-dom + Vite SSR** — DOM regression tests for input routing, menus, lesson state, and Guide behavior
- **Prettier** — Code and documentation formatting

## Project structure

```text
index.html                    Home / Game / Lesson
guide/index.html              Robotics Learning Guide
public/                       Static assets
src/
  main.ts                     Game / Lesson entry point
  types.ts                    Shared types for stages, GameContext, and ROS 2 data
  core/                       Navigation, input, progress, modals, and stage registration
    stage_collect.ts          Collects playable stages for the Game / Lesson runtime
    stage_def.ts              defineStage() and the stage registry
  guide/                      Guide UI, bilingual content, and card animations
    stages.ts                 Language-aware access to Guide metadata
    stages.generated.json     Generated descriptions, diagrams, and ROS interface examples
  i18n/                       Japanese and English dictionaries for games and lessons
  lib/                        Shared rendering, control, input, and editor modules
  stages/
    game/                     Game stages
    lesson/                   Lesson stages
  styles/                     Modular CSS for games and lessons
tests/
  control_math.test.ts         Coordinate and angle conversions
  navigation_stage.test.ts     Goal position/orientation and completion timing
  stage_menu.test.ts           Stage selection, focus, and mode transitions
  crash_terminal.test.ts       Failure recovery and returning from the terminal
  stage_readability.test.ts    HTML results, labels, reset, and cleanup
  guide_ui.test.ts             Guide content, navigation, and metadata isolation
scripts/
  gen-stage-list.mjs           Generates the README stage lists
  gen-guide-catalog.mjs        Generates bilingual Guide metadata from the same manifests
docs/
  ADD_A_STAGE.md              Instructions for adding a new stage
```

Vite builds `index.html` and `guide/index.html` as separate entry points. The Game / Lesson runtime
registers stages automatically with `import.meta.glob`. The Guide reads generated metadata
instead, sharing presentation helpers without loading executable stages or model weights.
The build rejects imports that would bring those implementations back into the Guide.

## Verification

After changing stage definitions, refresh the generated documentation before running checks:

```bash
npm run gen:stages
npm run gen:guide
npm test
npm run build
```

Tests cover model behavior, simulated ROS messages, goal completion, failure recovery, input
ownership, menu focus, terminal return controls, and DOM state during reset, language changes,
and stage disposal. Guide checks verify the current catalog and its separation from playable
stages. These tests do not validate rendered canvas pixels or physical controller drivers.

For UI changes, also check the production preview in a browser at phone, tablet, and desktop
widths (for example 375, 768, and 1280 px). Exercise stage selection, help, terminal return,
completion, retry, and switching between Game and Lesson with keyboard, touch, and available
gamepads. Check both Japanese and English.

## Stages

### GAME

<!-- STAGES:GAME -->
| # | ID | Concept |
|----|----|----|
| G1 | `delivery` | Publisher — drive the robot via a topic |
| G2 | `follower` | Subscriber — act on data from other nodes |
| G3 | `lidar_explorer` | Sensor Subscribe — read the world via LiDAR |
| G4 | `patrol` | Service & Lifecycle — shut down a runaway node |
| G5 | `racing` | Action — autonomous path-following navigation |
| G6 | `robo_soccer` | Robo Soccer — multi-robot teleop |
| G7 | `treasure_map` | Mapping (SLAM lite) — building /map from /scan |
| G8 | `tag_chase` | Multi-robot pursuit — read peer poses from a shared topic |
| G9 | `sumo_battle` | Odometry — knowing where you are via /odom |
| G10 | `battery_rush` | BatteryState — monitor the pack and auto-dock |
| G11 | `robo_kitchen` | Robo Kitchen — manipulation sequences |
| G12 | `swarm_rescue` | Swarm Helpers — multi-robot teamwork |
| G13 | `robo_baseball` | Vision Tracking — predict where the pitch will cross |
| G14 | `robo_tennis` | 3D Ball Tracking — position, height and bounce |
<!-- STAGES:GAME:END -->

### LESSON

<!-- STAGES:LESSON -->
| # | ID | Concept |
|----|----|----|
| L1 | `pubsub_builder` | Pub/Sub — link nodes via topics |
| L2 | `service_builder` | Service — request → response between Client and Server |
| L3 | `action_builder` | Action — long-running tasks + progress + cancellation |
| L4 | `param_tuner` | Parameters — live tuning with ros2 param set |
| L5 | `feedforward_controller` | Feedforward — draw an equilateral triangle by time |
| L6 | `feedforward_mission` | Feed-forward — publish a planned sequence of cmd_vel |
| L7 | `feedback_controller` | Feedback — draw an equilateral triangle with /odom |
| L8 | `feedback_mission` | Feedback Mission — dodge walls and reach GOAL via odom feedback |
| L9 | `lidar_avoidance` | Reactive Control — drive forward when /scan says the front is clear |
| L10 | `tf_puzzle` | TF — describe a sensor mount with a transform |
| L11 | `mapping_mission` | Teleop SLAM — drive and fill /map yourself |
| L12 | `localization_mission` | AMCL — estimate your pose inside a known map |
| L13 | `navigation` | Nav2 — click to send a goal, A* plans the path |
| L14 | `image_processing` | Image Processing |
| L15 | `edge_detection` | Camera + Teleop — observe Image Processing while driving |
| L16 | `object_detection` | Simulated Object Detection |
| L17 | `behavior_tree` | Behavior Tree — Nav2-style decision making |
| L18 | `joint_teleop` | JointState — jog each joint directly and watch the tip (forward kinematics) |
| L19 | `ik_reach` | Inverse Kinematics — command the tip pose, solve back for joint angles |
| L20 | `pick_place` | Pick & Place — grasp and transport |
| L21 | `imitation_learning` | Imitation Learning Mini Lab |
| L22 | `reinforcement_learning` | Reinforcement Learning Mini Lab |
| L23 | `vla_lab` | VLA Mini Lab |
| L24 | `world_model` | World Model Mini Lab |
<!-- STAGES:LESSON:END -->

These tables are generated from the `defineStage()` manifests. Do not edit content between the markers directly. Run `npm run gen:stages` after changing a stage.

The concept labels refer to the wider ROS 2 topic; each lesson implements a limited exercise.
Action Builder covers goal acceptance, feedback, and successful completion, with no cancel
operation. Parameter Tuner changes settings through on-screen controls, not terminal writes.
Behavior Tree explores the priority of condition/action rules, rather than editing asynchronous
Running states or Nav2 Recovery subtrees.

Navigation requires five goals that need a change of position or orientation. A goal is reached
only within the position and heading tolerances; resending an already satisfied goal does not
increase the count. Time covers the full five-goal attempt. Changing goal heading affects the
final in-place turn, while A* plans the route from positions.


## Add a new stage

See [`docs/ADD_A_STAGE.md`](docs/ADD_A_STAGE.md) for detailed instructions.

The basic workflow is:

1. Create `src/stages/game/<id>.ts` or `src/stages/lesson/<id>.ts`.
2. Implement a factory function that returns a `Stage`.
3. Default-export `defineStage({ mode, order, ... })`.
4. Extend `src/guide/` if the stage needs a custom explanation or animation.
5. Run `npm run gen:stages` and `npm run gen:guide` to update both generated catalogs.
6. Verify formatting, tests, the production build, and browser controls.

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development
workflow, project-specific requirements, verification steps, and pull request guidelines.

## Related learning resources

- [ROS 2 lectures and hands-on materials](https://mertcookimg.github.io/ros2_lecture/)
- [ROS 2 packages used in the lectures](https://github.com/mertcookimg/kachaka_ros2_lecture/)
- [Masato Kobayashi](https://mertcookimg.github.io/)
