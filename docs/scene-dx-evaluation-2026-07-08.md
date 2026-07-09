# Scene-DX Evaluation - LLM Scene Authoring (2026-07-08)

This first scene evaluation tested Drawstic from an LLM-authoring perspective. Seven agents built complete scenes with the Recipe DSL and CLI. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade: 1.9. The language was already strong for compact deterministic scene authoring, but several pain points repeated across agents: lighting helper ergonomics, organic closed shapes, local verification workflows, and clearer documentation for nontrivial composition.

## Scenario Coverage

| Scene | Primary stress area | Result |
|---|---|---|
| Arctic | snow, value separation, atmosphere | solid |
| Desert | dunes, heat, sparse detail | solid |
| Island | water, vegetation, layered depth | solid |
| Market | dense props, perspective, composition | most stressful |
| Orbit | curves, rings, glow, transforms | strong |
| Reef | organic shapes, water, colour ramps | solid |
| Volcano | glow, smoke, lava, silhouettes | strong |

## Main Findings

1. Lighting needed a simpler, more explicit helper path. `shadeRegion`, rim light, local glow, and contact AO were powerful but easy to misuse.
2. Organic masses lacked an ergonomic closed-curve primitive, which led to awkward `bezier` chains or blocky polygons.
3. Shape reuse and path structure worked, but agents needed clearer examples for composition and verification.
4. The CLI checks caught syntax and structural errors, but final craft quality still depended on image review.
5. The scene examples exposed useful pressure points for future docs, skills, and primitives.

## Follow-Up Actions

- Add or clarify lighting helpers and their argument order.
- Add curve-through-points and closed curve-region support.
- Improve scene craft guidance for layer order, contact shadows, and local light.
- Keep PNG review and small probe renders as required verification steps.
