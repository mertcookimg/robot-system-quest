# Contributing to Robot System Quest

Thank you for your interest in improving Robot System Quest. Bug reports, feature ideas,
documentation fixes, new tests, and code contributions are all welcome.

This guide describes the contribution process and the project-specific requirements that help
keep reviews focused and the learning experience consistent.

## Before you start

- Search the existing issues and pull requests before opening a new one.
- For a bug, open an issue with the browser and operating system, steps to reproduce, expected
  behavior, actual behavior, and screenshots or console errors when useful.
- For a significant feature, new dependency, or broad redesign, open an issue first so the
  approach and scope can be discussed before implementation.
- Small fixes and documentation improvements may be submitted directly as a pull request.

Please keep discussions constructive and respectful. Harassment, discrimination, and personal
attacks are not acceptable in project spaces.

## Development setup

You need a modern browser and Node.js 24.22.1 or later within the 24.x line.
Keep your local Node.js 24.x updated. CI and deployment builds use the latest
24.x release matching `engines.node` in [package.json](package.json).

1. Fork the repository on GitHub.
2. Clone your fork and install the dependencies:

   ```bash
   git clone https://github.com/<your-user>/robot-system-quest.git
   cd robot-system-quest
   npm ci
   ```

3. Create a branch from the latest `main`:

   ```bash
   git switch main
   git pull --ff-only
   git switch -c feat/short-description
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

The application is available at <http://localhost:5173/> and the Robotics Learning Guide at
<http://localhost:5173/guide/>.

`npm run dev` generates the bilingual Guide catalog before starting Vite. After changing stage
metadata while the server is running, run `npm run gen:guide` again to refresh the Guide.

Use a short, descriptive branch prefix such as `feat/`, `fix/`, `docs/`, `test/`, or `refactor/`.

## Make a focused change

- Keep each pull request to one logical change. Avoid unrelated cleanup or reformatting.
- Follow the existing TypeScript and CSS structure and reuse shared modules where practical.
- Add focused tests for changes to simulation or model behavior, controls, simulated telemetry,
  and DOM interactions. Reuse the existing test helpers where appropriate.
- Update documentation when behavior, controls, commands, or contributor workflows change.
- Do not commit generated build output from `dist/`.
- Never commit credentials, analytics IDs, or other secrets.

The app and Guide are separate Vite entry points. The playable app loads stage implementations;
the Guide reads [generated metadata](src/guide/stages.ts) and shares presentation helpers.
Keep stage factories, runtime controllers, and model weights out of Guide imports. The production
build checks that playable stages and VLA/world-model weights do not enter the Guide bundle.

## Commit and push

Commit messages and pull request titles use this format:

```text
<type>: <short imperative description>
```

Examples:

```text
feat: add an obstacle avoidance lesson
fix: clear stage timers during transitions
docs: explain touch controls
```

Use one of these types:

| Type       | Purpose                                   |
| ---------- | ----------------------------------------- |
| `feat`     | New user-facing behavior, Game, or Lesson |
| `fix`      | Bug fix                                   |
| `docs`     | Documentation only                        |
| `test`     | Add or update tests                       |
| `refactor` | Code change without a behavior change     |
| `style`    | Formatting only                           |
| `build`    | Build system or dependency change         |
| `ci`       | Continuous integration change             |
| `chore`    | Other maintenance                         |

Use imperative mood, keep the subject concise and lowercase, and do not add a trailing period.
Add a body when the reason, implementation choice, side effect, or compatibility impact is not
obvious. Reference a related issue in the footer when applicable, for example `Closes #123`.

This repository includes an optional commit message template. Enable it for this checkout with:

```bash
git config commit.template .gitmessage
```

After completing the verification steps below, commit the intended files and push your branch:

```bash
git add <changed-files>
git commit
git push -u origin feat/short-description
```

## Project-specific requirements

Robot System Quest is a client-side educational simulation. Contributions should preserve the
following principles:

- Do not describe simulated topics, services, sensors, or commands as communication with real
  ROS 2 systems or physical hardware.
- Provide both Japanese and English text for new user-facing content.
- Make learning-terminal observations reflect the stage's actual graph and published events.
  Advertise supported inspection commands through the shared command helpers; the terminal does
  not execute real ROS commands or train models.
- Keep the relevant experience usable with the supported input methods. Do not introduce a
  mouse-only task; verify keyboard, gamepad, and touch behavior where the changed feature uses
  them.
- Check layouts at narrow viewport widths and avoid hiding essential controls.
- Release event listeners, timers, animation handles, and stage-specific UI in the appropriate
  cleanup path. Use runtime-managed stage timers and restart handling so reset or navigation
  clears pending callbacks, held inputs, topic history, and terminal state.
- Respect input ownership while menus, dialogs, or the terminal are active. Reuse the shared
  keyboard/gamepad guards so closing a dialog does not also trigger a stage action.
- Preserve saved progress where possible. Call out intentional `localStorage` compatibility
  changes in the pull request.

For a new Game or Lesson, follow [Adding a New Game or Lesson](docs/ADD_A_STAGE.md). In particular:

- Put the entry point directly under `src/stages/game/` or `src/stages/lesson/`. The filename
  and `Stage.id` must match and use lowercase snake case; keep reusable helpers in `src/lib/`.
- Default-export a `defineStage()` manifest with a positive order unique within its mode.
  Lesson numbers come from this order, so do not hardcode them in `Stage.lesson`.
- Add Japanese and English stage strings and lesson content. Register Japanese display names
  and lesson labels in [src/core/stage_labels.ts](src/core/stage_labels.ts).
- Provide Guide copy, diagrams, and animations that explain the activity in both languages.
- Verify the stage with keyboard and gamepad controls, along with touch controls where applicable.
- Update affected stage-count and lesson-number assertions, along with descriptive counts in
  the README. The stage guide identifies the relevant tests and source-format constraints.

## Refresh generated source

After changing stage manifests or metadata, run both generators before testing:

```bash
npm run gen:stages
npm run gen:guide
```

`gen:stages` updates the README GAME and LESSON tables inside their respective marker pairs.
`gen:guide` updates [src/guide/stages.generated.json](src/guide/stages.generated.json) with
Japanese/English stage metadata and diagrams. Edit their source manifests rather than these
generated sections, review the generated diff, and include both updated outputs in the commit.

`npm test` checks that both outputs are current. `npm run dev` and `npm run build` regenerate
the Guide catalog, but do not regenerate the README tables. A running dev server does not
automatically rerun the catalog generator after metadata edits.

The VLA and world-model weight modules in `src/lib/` are also versioned source artifacts.
When changing those models, use the corresponding training scripts in `scripts/` as needed,
and describe any regenerated weights and model evaluation in the pull request. These source
artifacts are distinct from the untracked production output in `dist/`.

## Verify your change

Format the files you changed with Prettier and check repository formatting:

```bash
npm run format:check
```

`npm run format` formats all files covered by the repository configuration; use it only when
you intend to review that full diff. Both formatting commands respect [.prettierignore](.prettierignore),
which excludes `README.md` and `docs/`. Check edited documentation and its links explicitly.

After refreshing generated source, run the same audit, tests, and build used by CI:

```bash
npm audit --audit-level=high
npm test
npm run build
```

CI installs dependencies with `npm ci` before these checks. Formatting is an additional local
check, not currently a workflow step. `npm test` runs the TypeScript tests plus `check:stages`
and `check:guide`; `npm run build` regenerates Guide metadata, type-checks, and builds both
entry points while checking the Guide's dependency boundary.

Tests cover model behavior, simulated messages, completion and failure recovery, input ownership,
focus, and DOM state during reset, language changes, and disposal. They do not validate rendered
canvas pixels or physical controller drivers.

For visual or interactive changes, serve the production build with `npm run preview` and check:

- Japanese and English content, including stage labels, briefings, and Guide details.
- Keyboard, gamepad, and applicable touch controls, including editors and custom panels.
- Phone, tablet, and desktop widths (for example 375, 768, and 1280 px), with instructions,
  results, and completion actions remaining readable and reachable.
- Stage selection, direct Guide-to-stage links, and switching between Game and Lesson.
- Help, menus, and terminal entry/return, including pause behavior and held-button release.
- Completion, Retry, and stage changes, with no stale input, telemetry, terminal history,
  callbacks, or stage-specific UI left behind.

## Open a pull request

Push your branch to your fork and open a pull request against the `main` branch. Changes merged
into `main` are tested and deployed automatically; use a different target only when a maintainer
asks you to.

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). In the pull request:

- Format the pull request title like a commit message, for example
  `feat: add an obstacle avoidance lesson`.
- Explain what changed and why.
- Link the related issue with `Closes #123` when applicable.
- Describe how you tested the change.
- Confirm both generated stage tables and Guide metadata are current when stage data changes.
- Include screenshots or a short recording for visual or interactive changes.
- Mention known limitations, follow-up work, and any effect on saved data.
- Ensure all CI checks pass and respond to review feedback.

Submitting a pull request does not guarantee that it will be merged. Maintainers may request
changes or decline a contribution when it does not fit the project's scope or maintenance goals.

## Licensing

By intentionally submitting a contribution for inclusion in this project, you agree that it is
licensed under the project's [Apache License 2.0](LICENSE), as described in section 5 of that
license. No separate Contributor License Agreement is required.
