// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import * as input from "./input";
import { releasePlayerInput } from "../lib/two_player";
import { cancelNavpadInput } from "../lib/navpad";
import { suspend as suspendArmInput } from "../lib/armpad";
import { consumeStageGamepadButtons } from "../lib/stage_gamepads";

/** Release every input stream when a menu, terminal or another window owns input. */
export function releaseStageInputs(): void {
  consumeStageGamepadButtons();
  input.clearAll();
  input.syncKeys();
  releasePlayerInput();
  cancelNavpadInput();
  suspendArmInput();
}
