# Accounts, onboarding and the first program

## Accounts

* No passwords. On start the app shows a list of everyone who uses the home gym; pick your name and you are in.
* "New here" starts the onboarding. "Log out" in the menu returns to the list.
* Every person has their own programs, workouts, body data, coach log and goals.
  Exercises, media and equipment are shared, because they describe the same gym.
* The current user is remembered per device and sent with every request.

## Onboarding questions

| Question | Why it matters |
|---|---|
| Name | Account and leaderboard |
| Sex | Selects the male or female 3D model; programming itself is the same (see below) |
| Age | Over 50: more stable exercises, longer rests, more reps in reserve |
| Height, weight | BMI; above 30 the cardio stays joint friendly (walking, bike, stepper, no running intervals) |
| Training experience | Sets the level: beginner, intermediate or advanced |
| Trained regularly in the last 3 months? | People who stopped are treated one level lower for the first block |
| Main goal | Health, fast fat loss, muscle, strength or tone and shape. Sets rep ranges, cardio and volume |
| Target muscles | Picked on the 3D model or from a list. Become priority muscles with extra volume |
| Days per week | Chooses the split |
| Time per session | Caps the sets per session |
| Injuries or limits | Free text, passed to the AI coach |

## How the first program is built

The first program is written in two steps, so it is personal **and** follows the evidence.

**Step 1, the planner (Python, deterministic).** From the answers it derives the level, the split, a
weekly set budget per muscle, rep ranges, rest times, cardio minutes and the session time budget.
It then builds a skeleton: training days, and per day a list of slots (movement pattern, muscle,
sets, rep range, rest). For every slot it lists the matching exercises that the gym's equipment
allows.

**Step 2, the AI coach (Ollama).** It receives a detailed written report with all of this and picks
one exercise per slot from the candidates, names the days and explains the plan. Every answer is
checked; anything outside the candidate list is rejected and asked again. The report is stored and
can be read later under Coach.

### Rules the planner applies

**Level**

| Experience | Level |
|---|---|
| never, or less than 6 months | beginner |
| 6 to 24 months | intermediate |
| more than 2 years and trained in the last 3 months | advanced |
| any level, but not trained in the last 3 months | one level lower |

**Split** (ACSM 2009: novices 2 to 3 full body days, intermediates 3 to 4, advanced 4 to 6 with splits;
Schoenfeld 2016: each muscle at least twice a week)

| Days | Beginner | Intermediate and advanced |
|---|---|---|
| 2 | Full body A, B | Full body A, B |
| 3 | Full body A, B, C | Full body A, B, C |
| 4 | Full body A, B, C + cardio day | Upper, Lower, Upper, Lower |
| 5 | Full body A, B, C + 2 cardio days | Upper, Lower, Push, Pull, Legs |
| 6 | Full body A, B, C + 3 cardio days | Push, Pull, Legs, Push, Pull, Legs |

**Weekly sets per muscle** (Pelland 2025: more volume grows more with diminishing returns, beginners
already grow from little volume)

| Level | Normal muscle | Priority muscle |
|---|---|---|
| beginner | 8 | 12 |
| intermediate | 12 | 16 |
| advanced | 14 | 20 |

With the goal fast fat loss the normal volume drops by 2 sets, enough to keep muscle while
recovery is limited by the calorie deficit. Every session is capped by the time the person has.

**Rep ranges and effort** (Schoenfeld 2017: light and heavy loads build similar muscle when sets are
taken close to failure, heavy loads build more strength)

| Goal | Compound | Isolation |
|---|---|---|
| strength | 4 to 6 | 8 to 12 |
| muscle | 6 to 10 | 10 to 15 |
| tone and shape, health, fat loss | 8 to 12 | 12 to 15 |
| beginner, any goal | 8 to 12 | 12 to 15 |

Rest: compounds 120 s (strength 180 s), isolation 60 to 90 s. Sets end 1 to 3 reps before failure,
beginners 2 to 3.

**Cardio per week** (WHO 2020: 150 to 300 min moderate activity; ACSM 2009: more than 250 min for
clinically meaningful weight loss)

| Goal | Minutes |
|---|---|
| fast fat loss | 250 |
| tone and shape | 180 |
| health | 150 |
| muscle, strength | 90 |

Cardio is added at the end of strength days and on cardio days. BMI over 30 keeps it low impact.

**Sex.** Women and men gain the same relative muscle from the same training (Roberts 2020,
Refalo 2025), so the planner uses identical rules. Only the 3D model differs.

**Honesty about goals.** Fat cannot be lost from one spot. With the fat loss goal the coach says
that nutrition (a moderate calorie deficit) is the biggest lever.

## Leaderboard

Comparing raw kilograms would let the strongest person win forever and demotivate everyone else.
The leaderboard ranks **effort and relative progress**, resets every week and month, and has
several categories so different people can win:

| Category | Measured as |
|---|---|
| Consistency | completed workouts compared with planned days |
| Most improved | change of the personal strength index in percent |
| Personal bests | new estimated 1RM records |
| Volume | completed working sets |

The overall score adds points from all categories. Your own position is always shown with the
distance to the next place.

## Sources

* ACSM (2009), Progression Models in Resistance Training for Healthy Adults: https://tourniquets.org/wp-content/uploads/PDFs/ACSM-Progression-models-in-resistance-training-for-healthy-adults-2009.pdf
* Schoenfeld et al. (2016), Resistance Training Frequency and Hypertrophy, Sports Medicine: https://link.springer.com/article/10.1007/s40279-016-0543-8
* Pelland et al. (2025), The Resistance Training Dose Response: https://link.springer.com/article/10.1007/s40279-025-02344-w
* Schoenfeld et al. (2017), Low vs high load training: https://journals.lww.com/nsca-jscr/fulltext/2017/12000/strength_and_hypertrophy_adaptations_between_low_.31.aspx
* WHO (2020), Guidelines on physical activity and sedentary behaviour: https://iris.who.int/server/api/core/bitstreams/faa83413-d89e-4be9-bb01-b24671aef7ca/content
* ACSM (2009), Physical activity intervention strategies for weight loss: https://pubmed.ncbi.nlm.nih.gov/11740312/
* Roberts et al. (2020), Sex differences in resistance training: https://www.researchgate.net/publication/340216433_Sex_Differences_in_Resistance_Training_A_Systematic_Review_and_Meta-Analysis
* Refalo et al. (2025), Sex differences in relative muscle growth, PeerJ: https://peerj.com/articles/19042/
* Yu kai Chou, Leaderboard design: https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/

## 3D anatomy models

Male and female muscle models from the Fit Mit With anatomy atlas (218 named muscle regions each,
about 2.5 MB per model), adapted from Z-Anatomy and BodyParts3D, licensed CC BY-SA 4.0.
Each muscle mesh carries its name and training group, so the app can highlight and select muscles.
Rendered with three.js; drag to rotate 360 degrees, click or tap a muscle to select it.

* https://github.com/slfresh/fitmitwith-anatomy-atlas
* https://github.com/Z-Anatomy/Models-of-human-anatomy
* https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
