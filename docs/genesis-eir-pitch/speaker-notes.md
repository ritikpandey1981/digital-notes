# Folio — GENESIS EIR Cohort-3 · Speaker Notes

Total main deck: **11 slides, ~8–10 minutes.** Target roughly 45–75 seconds per slide.
Backup slides A–C are not part of the timed run; use them only in Q&A.

These notes are also embedded in the `.pptx` itself (Presenter View → Notes).

**Delivery reminders**

- The single most important framing in this deck: *we are not building an image
  generator.* Say it early and say it plainly.
- Be precise about what exists. The drawing prototype is real; the tutoring
  pipeline is not. Reviewers reward that precision far more than they reward
  optimism, and TRL 3 is an eligible stage for this programme.
- Slides 4, 5, 9 and 10 each contain an explicit "this part is not built yet"
  statement. Do not skip past them — they are the credibility of the pitch.

---

## Slide 1 — Cover / vision (~45 s)

Learning to draw is fundamentally a feedback-driven process. You draw something,
someone identifies what went wrong, you correct it, and you repeat.

But when people learn online today, that feedback loop largely disappears.

Folio is our attempt to bring that loop back using AI. Instead of generating
drawings for the learner, Folio observes how the learner draws and teaches them
how to improve.

What you see on the right is our current prototype, running — a purpose-built
sketching environment with a real drawing engine. We are at TRL 3, and we are
applying to GENESIS EIR to reach a validated TRL 4 tutoring prototype.

---

## Slide 2 — Problem (~60 s)

There is already an enormous amount of good drawing content available through
YouTube, courses and books. So another content library is not the primary
problem we want to solve.

The problem appears *after* the learner starts drawing. If they construct a cube
incorrectly, misunderstand perspective, distort a proportion or repeatedly use
poor line technique, a prerecorded video cannot look at their work and correct
them.

A tutor can — but one-to-one tutoring does not scale economically.

Precision Reports found that around 31% of online art learners report concerns
about limited instructor interaction and personalised feedback. That missing
feedback loop is the problem Folio is built around.

---

## Slide 3 — Solution (~60 s)

Folio creates the feedback loop that is missing from conventional online
learning.

The important distinction is that we do not want AI to replace the act of
drawing. The learner must still draw.

Folio observes that process, identifies weaknesses, explains them visually on the
canvas, and then chooses what the learner should practise next.

Over time the system builds a model of that learner's skills, rather than
treating every drawing as an isolated image. That is the difference between an
image generator and a tutor.

---

## Slide 4 — Product experience (~70 s)

This is where Folio differs from putting a chatbot next to a canvas.

Everything you see in this screenshot is the real prototype: the sketching
canvas, the tool dock, the pencil and pen engine, the tool options panel, layers
and colour. The box on the canvas was drawn through the real drawing pipeline.

If the learner is practising perspective, feedback should appear on the geometry
they actually drew. In this example the top-right edge rises away from its
vanishing point instead of converging toward it. Folio should show that edge,
display the correct construction direction, explain the principle in one
sentence, and immediately ask the learner to retry.

To be explicit: the canvas and tools are built. The AI feedback overlay on this
slide is a design illustration. Building and validating that pipeline is exactly
what we are applying to GENESIS for.

---

## Slide 5 — Technology / core innovation (~70 s)

The technological advantage we want to build is the intelligence around the
drawing *process* itself.

A finished image tells us what the learner produced. Stroke history can tell us
*how* they produced it — the order, the timing, the hesitations, the corrections,
the undo behaviour.

Combining those signals with geometric analysis, computer vision, multimodal
models and learner history gives Folio much richer context for teaching than a
photograph of a finished drawing.

I want to be precise about the claim: the drawing engine at the top of this
pipeline is built and working. Everything below it is what GENESIS EIR would
fund. And we do not claim a proprietary foundation model — our intended moat is
first-party drawing-process data, sketch understanding, learner history and the
pedagogical layer.

---

## Slide 6 — Market opportunity (~60 s)

We are entering a growing existing behaviour rather than trying to create one.
People are already learning creative skills digitally.

The global online art-course market is estimated at approximately 2.75 billion
dollars in 2026, projected to reach roughly 8.82 billion by 2035, at a 13.85
percent compound annual growth rate. More than 120 million learners participate
globally in online art-related education.

More importantly for our thesis, the same research identifies limited instructor
interaction and personalised feedback as a concern for around 31 percent of
learners. That is the gap we are building into.

In India, EdTech was 3.63 billion dollars in 2025 and is projected at 33.31
billion by 2034.

I want to be careful here: these are relevant market indicators, not Folio's
addressable market. Our initial beachhead is much narrower — self-directed
sketching learners and art, design and architecture students aged roughly 15
to 30.

---

## Slide 7 — Business model (~55 s)

Our initial model is intentionally simple: freemium business-to-consumer.

The drawing environment and some foundation exercises stay accessible for free.
Continuous personalised AI feedback, adaptive practice and skill progression
become the paid tier.

We are deliberately not quoting a price today. Pricing will be validated during
pilot testing — quoting a number we have not tested would not be honest.

Once the tutoring technology is validated, the same sketch-understanding
capability can support institutions, and can be offered as a sketch-analysis or
tutoring API. But business-to-consumer is the initial focus, because that is also
what generates the drawing-process data the technology needs.

---

## Slide 8 — Go-to-market (~60 s)

Our first users are concentrated in communities we can reach cheaply.

We start with a closed pilot of thirty to fifty learners drawn from art, design
and architecture students and self-taught sketching communities. The goal there
is not growth — it is validating feedback quality and learning the real error
distribution.

Then creator-led beta. Sketching is highly visual, which makes creator
distribution unusually effective. A creator can set an exercise, their audience
attempts it in Folio, and the feedback itself becomes shareable content — the
before-and-after *is* the advertisement.

That feeds a freemium launch through campus communities and referrals, and
finally institutional pilots with art institutes, design schools and architecture
colleges.

---

## Slide 9 — Competitive positioning (~55 s)

A course scales content but not individual attention. A human tutor gives
excellent contextual feedback but is expensive and time-constrained. Generative
AI can produce impressive images, but producing the result for the user is
fundamentally different from teaching the user to create it.

Read the Folio column carefully: it describes the *target* product architecture.
On-canvas correction, adaptive progression and learner memory are design targets,
not shipped features — that is precisely what we are asking GENESIS to help us
build and validate.

The point of this slide is the framing. We are not competing to generate the best
image. We are competing to build the best learning loop.

---

## Slide 10 — Current progress & TRL (~65 s)

We deliberately started by building the drawing environment, because an AI tutor
depends on understanding the interaction happening inside the canvas. You cannot
analyse stroke construction if you do not own the surface the strokes are made
on.

That foundation now exists as a functional prototype: a real drawing engine, core
tools, custom interactions, a purpose-built interface, and tested critical
workflows. We classify the project at TRL 3 — proof of concept.

The right-hand column is the honest gap. Stroke telemetry is architected but not
instrumented. Sketch analysis, the multimodal critique, the learner model,
on-canvas corrections and the curriculum are all still to build, and then to
validate with real learners.

We have built the environment in which learning happens. The next milestone is
making that environment understand the learner.

---

## Slide 11 — GENESIS EIR ask (~75 s)

The core risk in Folio today is not whether we can build another drawing
application — we have shown we can. It is whether we can turn drawing-process
information into feedback that measurably helps people learn.

That is exactly what we want to validate in the next twelve months. Telemetry and
an evaluation framework in the first quarter. Multimodal critique and a first
tutoring engine by month six. An integrated tutoring MVP and a closed pilot with
thirty to fifty learners by month nine. Then measurement of learning outcomes and
preparation for institutional pilots.

GENESIS EIR provides up to ten lakh rupees along with incubation and mentorship,
and it accepts technologies at TRL 1 to 4. That is a precise fit for where Folio
is: a working prototype that now needs to become a validated one.

Our long-term goal is simple — make the kind of personalised feedback currently
available mainly through tutors accessible to anyone learning to draw.

Don't let AI draw for you. Let it teach you how to draw.

---

## Backup A — Detailed technical architecture

The pipeline in three bands.

**Capture:** the canvas engine — which exists — plus an event and stroke logger
that records how the drawing was constructed, not only the result.

**Understand:** feature extraction splitting into a geometry engine for
perspective and proportion, a vision model for the rendered image, and
stroke-behaviour features from the telemetry. Those three merge in a multimodal
context builder.

**Teach:** learner state, pedagogical reasoning, a feedback policy that decides
what is worth saying, and finally canvas annotation and exercise generation.

Only the canvas engine is built today. Everything after it is the TRL 3 → 4
programme.

---

## Backup B — What we need to validate

Four hypotheses: can Folio reliably identify specific beginner sketching errors;
are AI-generated corrections pedagogically accurate; do learners improve faster
with Folio feedback than with self-guided practice alone; and will they come back
for it.

The metrics below are what we would instrument during the closed pilot.
Diagnostic precision and feedback acceptance test whether the system is *right*.
Completion, repeat attempts and improvement between attempts test whether it
*teaches*. Retention and satisfaction test whether it is *worth using*.

---

## Backup C — Expansion roadmap

We start narrow, on foundational sketching, because that is where the error
patterns are most common and most teachable, and where we can measure improvement
fastest.

From there the same machinery extends to perspective, form, object drawing,
anatomy, portrait construction, environments, architectural sketching and
industrial or product sketching. Each is a new curriculum and a new set of
analysers on the same pipeline.

Longer term, nothing about the architecture is specific to drawing. A system that
observes a process, diagnoses it and teaches it is a general engine for learning
visual skills.

---

## Likely questions

**"Isn't this just GPT with a canvas?"**
No. A general model sees a finished image. Folio owns the surface the drawing is
made on, so it can capture stroke order, timing, pressure and correction
behaviour. That process data, plus the learner's history, is what a general model
cannot get. The model is a component, not the product.

**"Why should you build the drawing app instead of a plugin?"**
Because the teaching signal lives in the interaction. A plugin on someone else's
canvas gets the image; it does not reliably get how the image was made, and it
cannot control the exercise or the correction surface.

**"How far along are you really?"**
The sketching application is a working prototype with a real drawing engine,
tools, layers, colour and tested workflows. The AI tutoring pipeline is
architecture and design, not implementation. TRL 3.

**"What is the biggest risk?"**
Diagnostic accuracy. If Folio tells a learner something is wrong when it is not,
trust collapses immediately. That is why Backup B leads with diagnostic precision
and feedback acceptance, and why the first pilot is deliberately small.
