# Robot System Quest: Games and Lessons

Robot System Quest: Games and Lessons is a browser-based learning experience for exploring the fundamentals of ROS 2 and robotic systems by controlling robots and playing games.

It visualizes concepts such as publishers, subscribers, services, actions, feedforward and feedback control, LiDAR, image processing, TF, SLAM, localization, Nav2, behavior trees, and manipulation through games and interactive lessons. It does not connect to a real ROS 2 environment.

- **GAME** — 14 stages that introduce robotics concepts through delivery missions, racing, robot soccer, mapping, and more
- **LESSON** — 20 stages for experimenting with node wiring, block editing, parameter tuning, image processing, navigation, and more
- **ROBOTICS LEARNING GUIDE** — Bilingual explanations of what to try and observe in each game and lesson
- **Keyboard / Gamepad / Touch** — Keyboard and gamepad support across all stages, plus controls designed for touch devices
- **Japanese / English** — Switch the interface language at any time
- **Client-side only** — Runs without a backend

> This project is a simplified simulation for learning ROS 2 concepts. It does not communicate with physical ROS 2 nodes or sensors.

## Run locally

You will need Node.js 22.12 or later and a modern browser.

```bash
npm install
npm run dev
```

The development server uses these URLs by default:

- Home / Game / Lesson: <http://localhost:5173/>
- Robotics Learning Guide: <http://localhost:5173/guide/>

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

## npm scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check the project and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run control-logic tests and verify the generated stage lists |
| `npm run format` | Format code and documentation with Prettier |
| `npm run format:check` | Check for formatting differences |
| `npm run gen:stages` | Update the README stage lists from the stage manifests |
| `npm run check:stages` | Check that the README stage lists are up to date |

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

Gamepad API button numbers and names may differ by browser, operating system, and controller.

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
- **Node.js Test Runner + tsx** — Automated tests for control logic
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
    stage_collect.ts          Automatically collects src/stages/**/*.ts
    stage_def.ts              defineStage() and the stage registry
  guide/                      Guide UI, bilingual content, and card animations
  i18n/                       Japanese and English dictionaries for games and lessons
  lib/                        Shared rendering, control, input, and editor modules
  stages/
    game/                     Game stages
    lesson/                   Lesson stages
  styles/                     Modular CSS for games and lessons
tests/
  control_math.test.ts        Regression tests for coordinate and angle conversions
scripts/
  gen-stage-list.mjs          Generates the README stage lists
docs/
  ADD_A_STAGE.md              Instructions for adding a new stage
```

Vite builds `index.html` and `guide/index.html` as separate entry points. Stages are registered automatically with `import.meta.glob`, so there is normally no central list to update by hand.

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
| L16 | `object_detection` | Object Detection |
| L17 | `behavior_tree` | Behavior Tree — Nav2-style decision making |
| L18 | `joint_teleop` | JointState — jog each joint directly and watch the tip (forward kinematics) |
| L19 | `ik_reach` | Inverse Kinematics — command the tip pose, solve back for joint angles |
| L20 | `pick_place` | Pick & Place — grasp and transport |
<!-- STAGES:LESSON:END -->

These tables are generated from the `defineStage()` manifests. Do not edit content between the markers directly. Run `npm run gen:stages` after changing a stage.

## Add a new stage

See [`docs/ADD_A_STAGE.md`](docs/ADD_A_STAGE.md) for detailed instructions.

The basic workflow is:

1. Create `src/stages/game/<id>.ts` or `src/stages/lesson/<id>.ts`.
2. Implement a factory function that returns a `Stage`.
3. Default-export `defineStage({ mode, order, ... })`.
4. Extend `src/guide/` if the stage needs a custom explanation or animation.
5. Verify formatting, tests, the production build, and browser controls.

## Related learning resources

- [ROS 2 lectures and hands-on materials](https://mertcookimg.github.io/ros2_lecture/)
- [ROS 2 packages used in the lectures](https://github.com/mertcookimg/kachaka_ros2_lecture/)
- [Masato Kobayashi](https://mertcookimg.github.io/)
