# Coach logic

How the workout tracker adapts your training automatically, and why.
The rules are based on current research. Sources are listed at the end.

## Core idea: three time scales

The program changes on three levels, each with its own pace. Training stays stable enough to measure
progress, and still changes in time when you get stuck.

| Level | Pace | What changes | Who decides |
|---|---|---|---|
| Workout | after every workout | weight and rep target per exercise | fixed rules |
| Block | every 4 to 6 weeks (default 5) | sets per muscle, exercise swaps, coach review | rules set the limits, the local AI coach picks exercises and writes the review |
| Deload | last week of each block, or earlier when fatigued | half the sets, same weight | rules |

Exercises are never swapped from workout to workout. At the earliest they change at the end of a block,
and only when the data shows the exercise is no longer working.

## Level 1: double progression (after every workout)

Every exercise in a program has a rep range, for example 8 to 12, and a target weight.

1. Hit the **top of the range in all planned sets** with the target weight and the weight goes up to the
   **next step you actually own** (from your equipment list, e.g. 12.5 kg to 15 kg dumbbells).
   The rep target starts at the bottom of the range again.
2. Inside the range, the weight stays. You add reps.
3. If the **first set falls below the bottom of the range twice in a row**, the weight goes one step back.
4. In the first workout with an exercise, the heaviest weight used becomes the target weight.

Load progression and rep progression produce practically the same muscle growth (Plotkin et al. 2022).
Combining both is the robust default, especially with dumbbells where weight jumps are large.

**Bodyweight exercises** (chin up, dips, push up): when all sets reach the top twice in a row the range
moves up by 2 reps. From a top of 20 reps the exercise counts as too easy and is swapped for a harder
variant at the end of the block.

**Timed exercises** (plank): all sets at the top of the range adds 10 percent time.

After every workout the AI coach also writes a short note with one observation and one tip.

## Level 2: block review (every 4 to 6 weeks)

At the end of every block (default: 4 build weeks and 1 deload week) the following happens.

### Measure strength
For every exercise the estimated one rep max (e1RM) is calculated per workout:

    e1RM = weight × (1 + reps / 30)     (Epley)

The formula is accurate up to about 10 reps and less precise above. For trends that is enough because
the same formula is always used.

An exercise counts as **stalled** when its best e1RM in the block is not at least 1 percent above the
previous block and its target weight did not rise during the block.

### Volume per muscle
Weekly sets per muscle are counted **fractionally**: target muscle counts 1 set, secondary muscle 0.5 sets.
Pelland et al. (2025) show this counting predicts outcomes best, and that more volume brings more growth
with diminishing returns.

| Muscle | Minimum | Maximum |
|---|---|---|
| normal | 10 | 20 |
| priority (biceps, abs) | 14 | 22 |

Rules per block:
* Below the minimum: plus 2 sets.
* Priority muscle below the maximum: plus 1 set.
* Normal muscle stalled and below the maximum: plus 1 set.
* Above the maximum: minus 1 set.
* Limits: at most 5 sets per exercise, 24 sets per session and 8 added sets per block.

### Exercise swaps
* Only **stalled** exercises that have been in the program for **at least one full block** are swapped.
* At most **2 swaps per block** across the whole plan, so progress stays comparable.
  Kassiano et al. (2022): targeted variation helps, too much variation hurts.
* Swaps happen right away only when you mark equipment as unavailable.
* The rules build a candidate list: same movement pattern, same target muscle, only equipment you own,
  not used in the last two blocks. **The local AI coach picks from these candidates** and explains why.
  Every answer is validated, an exercise outside the list is rejected.

### Coach review
The AI coach receives the results of the block and writes a review: what went well, what stalled,
what the changes mean and one focus for the next block.

## Level 3: deload

* Planned: last week of the block. Half the sets (at least 1), same weight.
  The consensus of Bell et al. (2023) recommends reducing volume at roughly the same intensity.
* Early deload: if in two workouts in a row more than half of the exercises are over 5 percent below
  their average, or when you press "I am wiped out", the deload starts right away, earliest in week 3.

## Your goals

**Biceps and abs** are set as priority muscles. They get higher volume targets (14 to 22 sets per week)
and receive added sets first at the end of each block. Priorities can be changed under Coach.

**A leaner face**, honestly: spot fat loss does not work. The meta analysis by Ramirez Campillo et al.
(2021, 13 studies, 1158 people) found no effect. Face fat drops only together with total body fat.
The app supports that with:
* Body weight entries with a 7 day average and trend.
* A weekly cardio target, default 150 minutes.
* If the weight trend stalls under the fat loss goal, cardio minutes in the cardio sessions rise by
  10 percent at the end of the block (up to 300 minutes per week). Nutrition remains the biggest lever,
  and the app says so.

## Running it manually

Under **Coach**:
* "Check progression" evaluates all workouts that were not evaluated yet.
* "Finish block now" runs the block review right away and starts a new block.
* "Redesign" lets the AI coach rebuild a program under the same rules.
* "Deload now" starts the deload right away.

Every change lands in the coach log with its reason and can be undone with one click.
No confirmation is needed.

## The role of the AI

The AI coach is a required part of the app. It runs locally in Docker with Ollama (model qwen2.5 7B),
nothing leaves your network.

* **The AI decides**: which replacement exercise to use, how to redesign a program, and it writes the
  workout notes and the block review.
* **The rules decide**: weights, rep targets, set limits and timing, because small language models are
  unreliable with numbers.

If the AI coach is offline, logging still works and weights still progress after every workout.
Block reviews, swaps and redesigns wait and run automatically as soon as the AI is back.
A red bar at the top of the app shows this state.

## Sources

* Plotkin et al. (2022), Progressive overload without progressing load, PeerJ: https://peerj.com/articles/14142/
* Pelland et al. (2025), The Resistance Training Dose Response, Sports Medicine: https://link.springer.com/article/10.1007/s40279-025-02344-w
* Bell et al. (2023), Integrating Deloading into Strength and Physique Sports Training Programmes, Sports Medicine Open: https://link.springer.com/article/10.1186/s40798-023-00633-0
* Kassiano et al. (2022), Does Varying Resistance Exercises Promote Superior Muscle Hypertrophy and Strength Gains?, JSCR: https://www.ovid.com/jnls/nsca-jscr/fulltext/10.1519/jsc.0000000000004258
* Ramirez Campillo et al. (2021), spot reduction meta analysis, Human Movement: https://hummov.awf.wroc.pl/A-proposed-model-to-test-the-hypothesis-of-exercise-induced-localized-fat-reduction,143162,0,2.html
* Epley and Brzycki validation: https://opensiuc.lib.siu.edu/cgi/viewcontent.cgi?article=1744&context=gs_rp

## Projector mode

A projector cannot display black: dark areas show as the colour of the lit wall, so dark themes turn
into low contrast grey in a room with any light. Projector mode therefore switches to an ivory
background with near black text (ivory instead of pure white to limit glare, as Tufte recommends),
dark saturated accent colours instead of light tints or yellow, wide bold type instead of condensed
type, thicker lines and borders, and 30 percent larger sizes.

* Tufte, Recommended background for projected presentations: https://www.edwardtufte.com/notebook/recommended-background-for-projected-presentations/
* Nayamode, Presentation design tips for projecting: https://nayamode.com/blog/must-know-presentation-design-tips-for-projecting/
