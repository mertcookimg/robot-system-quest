// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import "../styles/31-lab-completion.css";

/** Keep completion visible even when the learner is reading controls below the canvas. */
export function mountLabCompletion(onClose: (event: Event) => void): () => void {
  const completion = document.getElementById("clear-overlay");
  if (!completion?.parentElement) return () => {};
  const slot = document.createComment("lab-completion-slot");
  completion.before(slot);
  document.body.append(completion);
  completion.classList.add("lab-completion-layer");
  completion.addEventListener("clear-overlay-close", onClose);
  return () => {
    completion.removeEventListener("clear-overlay-close", onClose);
    completion.classList.remove("lab-completion-layer");
    slot.replaceWith(completion);
  };
}

/** Share one responsive region for the robot and its nearby experiment controls. */
export function mountLabWorkbench(canvas: HTMLCanvasElement): () => void {
  const scene = canvas.parentElement;
  const controls = document.getElementById("stage-controls-dock");
  if (
    !scene?.parentElement ||
    scene === document.body ||
    !controls?.parentElement ||
    scene.contains(controls) ||
    controls.contains(scene)
  )
    return () => {};
  const slots = [scene, controls].map((node) => {
    const marker = document.createComment("lab-workbench-slot");
    node.before(marker);
    return { node, marker };
  });
  const workbench = document.createElement("div");
  workbench.className = "lab-workbench";
  slots[0].marker.after(workbench);
  workbench.append(scene, controls);
  return () => {
    for (const { node, marker } of slots) marker.replaceWith(node);
    workbench.remove();
  };
}
