"use strict";
/**
 * stepping-stones.js — the 5 emotional-resonance stones, each with 6 sub-themes (30 total).
 * The stone number is passed through the pipeline (script generator uses it for emotional tone);
 * the theme string drives the image + captions.
 */
const STEPPING_STONES = {
  1: {
    label: "Knowing What's Normal vs. a Warning Sign",
    themes: [
      "the vet waiting room",
      "sudden sleeping more than usual",
      "the mysterious limp investigation",
      "appetite changes under surveillance",
      "the lump discovery protocol",
      "selective hearing diagnosis",
    ],
  },
  2: {
    label: "Managing Pain & Mobility",
    themes: [
      "the stairs situation",
      "the morning stiffness routine",
      "the leash negotiation",
      "the slow walk pride",
      "couch dismount strategy",
      "physical therapy indignity",
    ],
  },
  3: {
    label: "Getting Nutrition Right",
    themes: [
      "the new food betrayal",
      "the treat negotiation",
      "dinner time countdown",
      "the empty water bowl",
      "the food bowl situation",
      "supplement pill detection",
    ],
  },
  4: {
    label: "Recognizing Cognitive Decline",
    themes: [
      "the 3am zoomies memory",
      "back in my day",
      "the other dog at the park",
      "squirrel geopolitics",
      "the room I just walked into",
      "retirement speech",
    ],
  },
  5: {
    label: "End-of-Life Peace of Mind",
    themes: [
      "belly rub diplomacy",
      "birthday dignity",
      "the couch cushion ownership",
      "morning routine resistance",
      "blanket theft investigation",
      "the nap defense protocol",
    ],
  },
};

module.exports = {STEPPING_STONES};
