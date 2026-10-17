# Locomotion calibration references

Use population ranges and test protocols as calibration targets, rather than a single elite outlier.

- **40 m sprint:** Pasquarelli et al. tested 154 first-division professional footballers with timing gates at 0, 10, 20, 30, and 40 m. Their fast, intermediate, and slow groups covered 4.877–5.174 s, 5.175–5.474 s, and 5.475–5.766 s respectively. The existing balanced preset currently falls in the intermediate band. [Study](https://periodicos.ufsc.br/index.php/rbcdh/article/view/1980-0037.2009v11n4p408)
- **Acceleration and direction changes:** A study of male and female soccer players found 10 m sprint time strongly associated with 505 change-of-direction performance (male correlations about 0.69–0.70). It also describes a 20 m sprint followed by a maximal deceleration test and 505 turn protocol, useful as repeatable benchmarks for braking and re-acceleration. [Study](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.1027811/full)
- **Cut mechanics:** A college-soccer study measured vertical and mediolateral ground reaction forces, contact time, and actual cutting angle during a 10 m sprint with a 60° change of direction. This supports measuring contact forces, contact duration, and the traveled path together; a single requested turn angle is not enough to validate realism. [Study](https://iris.uniroma4.it/handle/20.500.14244/6107)

- **Movement labels:** One elite-youth soccer workload study uses walk 0.2–1.9 m/s, jog 2.0–3.9 m/s, run 4.0–5.4 m/s, high-speed run 5.5–6.9 m/s, and sprint at 7.0 m/s or faster. These are study-specific bins, not universal gait boundaries. The default jog cap is set to 3.8 m/s; 4.8 m/s remains a run-band reference for the cadence curve. [Study](https://researchportal.hw.ac.uk/en/publications/analysis-of-movement-demands-high-intensity-running-and-temporary/)

The sprint benchmark tests use the measured professional 40 m cohort range. Braking and cutting values should remain provisional until the simulation reproduces the published test setup and comparison variables; the 505 test and a generic 90° in-game turn are not interchangeable.

The locomotion acceleration mapping now follows the documented 4.8–7.5 m/s² player-attribute range; the balanced preset maps to 6.96 m/s². The cited male soccer sample reports theoretical horizontal force-to-mass values around 6.5–7.0 N/kg, which is a useful comparison rather than a direct one-to-one prescription for every acceleration phase.

## Slice 3 touch contract

Use `PlayerState.contactState` as the foot and center-of-mass source for ball contacts. Keep the ball response physical; touch intent selects the desired cushioning or outgoing direction, while technical skill limits the correction and increases execution error under high incoming speed, poor foot alignment, or pressure. Do not move the ball by scripted position offsets. First touch, dribbling, and trapping behavior remain future Slice 3 work.
