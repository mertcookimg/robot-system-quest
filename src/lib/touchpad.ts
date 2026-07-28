// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, onLangChange } from "../i18n";

// Virtual controls for keyboard-less devices. Inputs are translated into the
// same KeyboardEvents used by the physical keyboard path, so every stage keeps
// one input pipeline.

type MoveKey = "w" | "a" | "s" | "d";
type TouchLayout = "dpad" | "joystick";

const STORE_KEY = "robot_quest_touch_layout_v1";
const MOVE_KEYS: MoveKey[] = ["w", "a", "s", "d"];

function sendKey(key: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key, bubbles: true }));
}

function holdButton(label: string, key: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `touch-button ${className}`;
  button.textContent = label;

  let held = false;
  const release = () => {
    if (!held) return;
    held = false;
    button.classList.remove("pressed");
    sendKey(key, false);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    held = true;
    button.classList.add("pressed");
    sendKey(key, true);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  return button;
}

function createDpad(): HTMLElement {
  const dpad = document.createElement("div");
  dpad.className = "touch-dpad";
  dpad.setAttribute("aria-label", "Directional pad");
  dpad.append(
    holdButton("▲", "w", "touch-up"),
    holdButton("◀", "a", "touch-left"),
    holdButton("▶", "d", "touch-right"),
    holdButton("▼", "s", "touch-down"),
  );
  return dpad;
}

function createJoystick(): { element: HTMLElement; release: () => void } {
  const base = document.createElement("div");
  base.className = "touch-joystick";
  base.setAttribute("role", "application");
  base.setAttribute("aria-label", "Virtual joystick");

  const knob = document.createElement("div");
  knob.className = "touch-joystick-knob";
  base.appendChild(knob);

  const held = new Set<MoveKey>();
  const applyKeys = (next: Set<MoveKey>) => {
    for (const key of MOVE_KEYS) {
      if (next.has(key) === held.has(key)) continue;
      sendKey(key, next.has(key));
      next.has(key) ? held.add(key) : held.delete(key);
    }
  };

  const update = (event: PointerEvent) => {
    const rect = base.getBoundingClientRect();
    const radius = rect.width * 0.32;
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > radius ? radius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    knob.style.transform = `translate(${x}px, ${y}px)`;

    const threshold = radius * 0.28;
    const next = new Set<MoveKey>();
    if (x < -threshold) next.add("a");
    if (x > threshold) next.add("d");
    if (y < -threshold) next.add("w");
    if (y > threshold) next.add("s");
    applyKeys(next);
  };

  const release = () => {
    knob.style.transform = "translate(0, 0)";
    applyKeys(new Set());
    base.classList.remove("active");
  };

  base.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    base.setPointerCapture(event.pointerId);
    base.classList.add("active");
    update(event);
  });
  base.addEventListener("pointermove", (event) => {
    if (base.hasPointerCapture(event.pointerId)) update(event);
  });
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);
  base.addEventListener("lostpointercapture", release);

  return { element: base, release };
}

function readLayout(): TouchLayout {
  try {
    return localStorage.getItem(STORE_KEY) === "joystick" ? "joystick" : "dpad";
  } catch {
    return "dpad";
  }
}

export function setupTouchpad(): void {
  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    matchMedia("(pointer: coarse)").matches;
  if (!isTouch) return;

  const root = document.createElement("section");
  root.id = "touchpad";
  root.className = "touchpad";

  const toolbar = document.createElement("div");
  toolbar.className = "touchpad-toolbar";
  const title = document.createElement("strong");
  title.className = "touchpad-title";

  const switcher = document.createElement("div");
  switcher.className = "touchpad-switcher";
  switcher.setAttribute("role", "group");
  const dpadToggle = document.createElement("button");
  dpadToggle.type = "button";
  dpadToggle.textContent = "✥ D-PAD";
  const joystickToggle = document.createElement("button");
  joystickToggle.type = "button";
  joystickToggle.textContent = "◉ JOY";
  switcher.append(dpadToggle, joystickToggle);
  toolbar.append(title, switcher);

  const controls = document.createElement("div");
  controls.className = "touchpad-controls";
  const moveZone = document.createElement("div");
  moveZone.className = "touch-move-zone";
  const dpad = createDpad();
  const joystick = createJoystick();
  moveZone.append(dpad, joystick.element);

  const actions = document.createElement("div");
  actions.className = "touch-actions";
  actions.append(
    holdButton("BOOST", "Shift", "touch-boost"),
    holdButton("OK", " ", "touch-ok"),
    holdButton("✕", "Escape", "touch-cancel"),
    holdButton("R", "r", "touch-reset"),
  );
  controls.append(moveZone, actions);
  root.append(toolbar, controls);

  let layout = readLayout();
  const setLayout = (next: TouchLayout) => {
    layout = next;
    joystick.release();
    root.dataset.layout = layout;
    dpadToggle.classList.toggle("active", layout === "dpad");
    joystickToggle.classList.toggle("active", layout === "joystick");
    dpadToggle.setAttribute("aria-pressed", String(layout === "dpad"));
    joystickToggle.setAttribute("aria-pressed", String(layout === "joystick"));
    try {
      localStorage.setItem(STORE_KEY, layout);
    } catch {
      // Controls still work when storage is unavailable.
    }
  };
  dpadToggle.addEventListener("click", () => setLayout("dpad"));
  joystickToggle.addEventListener("click", () => setLayout("joystick"));

  const refreshLanguage = () => {
    const ja = getLang() === "ja";
    title.textContent = ja ? "タッチ操作" : "TOUCH CONTROLS";
    root.setAttribute("aria-label", ja ? "画面上のタッチ操作" : "On-screen touch controls");
    switcher.setAttribute("aria-label", ja ? "移動操作の種類" : "Movement control style");
    dpadToggle.setAttribute(
      "aria-label",
      ja ? "矢印キー型に切り替える" : "Use directional buttons",
    );
    joystickToggle.setAttribute(
      "aria-label",
      ja ? "ジョイスティック型に切り替える" : "Use joystick",
    );
  };
  refreshLanguage();
  onLangChange(refreshLanguage);
  setLayout(layout);

  const layoutAnchor =
    document.getElementById("stage-controls-dock") ?? document.getElementById("canvas-wrap");
  layoutAnchor?.insertAdjacentElement("afterend", root);

  const releaseMovement = () => {
    joystick.release();
    MOVE_KEYS.forEach((key) => sendKey(key, false));
  };
  window.addEventListener("blur", releaseMovement);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseMovement();
  });
}
