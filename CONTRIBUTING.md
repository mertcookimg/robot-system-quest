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

You need Node.js 22.12 or later and a modern browser.

1. Fork the repository on GitHub.
2. Clone your fork and install the dependencies:

   ```bash
   git clone https://github.com/<your-user>/robot-system-quest.git
   cd robot-system-quest
   npm ci
   ```

3. Create a branch from `develop`:

   ```bash
   git switch develop
   git pull --ff-only
   git switch -c feat/short-description
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

The application is available at <http://localhost:5173/> and the Robotics Learning Guide at
<http://localhost:5173/guide/>.

Use a short, descriptive branch prefix such as `feat/`, `fix/`, `docs/`, `test/`, or `refactor/`.

## Make a focused change

- Keep each pull request to one logical change. Avoid unrelated cleanup or reformatting.
- Follow the existing TypeScript and CSS structure and reuse shared modules where practical.
- Add or update tests for behavior that can be tested independently of the browser.
- Update documentation when behavior, controls, commands, or contributor workflows change.
- Do not commit generated build output from `dist/`.
- Never commit credentials, analytics IDs, or other secrets.

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

Then commit and push your branch:

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
- Keep the relevant experience usable with the supported input methods. Do not introduce a
  mouse-only task; verify keyboard, gamepad, and touch behavior where the changed feature uses
  them.
- Check layouts at narrow viewport widths and avoid hiding essential controls.
- Release event listeners, timers, animation handles, and stage-specific UI in the appropriate
  cleanup path.
- Preserve saved progress where possible. Call out intentional `localStorage` compatibility
  changes in the pull request.

For a new Game or Lesson, follow [Adding a New Game or Lesson](docs/ADD_A_STAGE.md). In particular:

- The filename and `Stage.id` must match and use lowercase snake case.
- Export a `defineStage()` manifest with a unique order.
- Add Japanese and English lesson content, and update the Guide when a custom explanation is
  needed.
- Verify the stage with keyboard and gamepad controls, along with touch controls where applicable.
- Run `npm run gen:stages` after changing stage manifests. Do not edit the generated README stage
  tables between their marker comments by hand.

## Verify your change

Run the same essential checks used by continuous integration:

```bash
npm run format
npm run format:check
npm test
npm run build
```

Also test affected behavior in a browser. For visual or interactive changes, check both Japanese
and English, the relevant input methods, and a narrow viewport. Confirm that resetting or changing
stages does not leave stale state or UI behind.

## Open a pull request

Push your branch to your fork and open a pull request against the `develop` branch. The `main`
branch is the deployment branch; use a different target only when a maintainer asks you to.

In the pull request:

- Format the pull request title like a commit message, for example
  `feat: add an obstacle avoidance lesson`.
- Explain what changed and why.
- Link the related issue with `Closes #123` when applicable.
- Describe how you tested the change.
- Include screenshots or a short recording for visual or interactive changes.
- Mention known limitations, follow-up work, and any effect on saved data.
- Ensure all CI checks pass and respond to review feedback.

Submitting a pull request does not guarantee that it will be merged. Maintainers may request
changes or decline a contribution when it does not fit the project's scope or maintenance goals.

## Licensing

By intentionally submitting a contribution for inclusion in this project, you agree that it is
licensed under the project's [Apache License 2.0](LICENSE), as described in section 5 of that
license. No separate Contributor License Agreement is required.
