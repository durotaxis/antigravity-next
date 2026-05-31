# Fit Accurate Chart Notes

Last updated: 2026-05-31

## Purpose

This note explains the intent behind the legacy screen's third chart:

- `Speed (accurate) + HR (accurate)`

The goal is to preserve the reasoning behind the current implementation so that later maintenance does not start from a wrong assumption.

## What the chart is trying to do

The third chart is meant to show:

- a fine-grained speed signal
- a fine-grained heart-rate signal
- on the same time axis

The practical goal is visual comparison of trend and timing.
It is not intended to be a medical-grade or physics-grade reconstruction of two perfectly synchronized raw sensors.

## Important clarification about heart rate

Even when the saved data appears to have one heart-rate point every second, that does **not** necessarily mean:

- COROS natively emits a "true 1 Hz raw heart-rate signal"

Heart rate is fundamentally represented as:

- BPM at a sampled moment or short interval

not as a per-beat event stream inside this application.

Because of that, the current behavior is acceptable for the chart's purpose:

- we use the saved BPM sample series as a display signal
- we do not need to treat it as a strict, physically raw 1-second sensor stream

## Important clarification about speed

The speed series used by the third chart comes from:

- `com.google.speed`

and is displayed as:

- raw value in `m/s`
- converted to `km/h` for chart display

This is a strong advantage of the current approach:

- the chart is using the same kind of speed/pace signal that Google Fit exposes

So even if the internal source chain is:

- `COROS -> Health Connect -> Google Fit -> this app`

the visible behavior still aligns with the speed/pace signal seen in Google Fit.

## Important clarification about `dist`

One confusing detail is the source name:

- `com.yf.smart.coros.dist`

This can look like "distance raw data", but that is **not** what defines the chart's speed series.

The key distinction is:

- `com.google.speed`
  - the **data type**
- `com.yf.smart.coros.dist`
  - part of the **source/application identifier**

So the chart is not using "distance raw data" just because the source name contains `dist`.
For the accurate speed chart, the actual data type is speed.

## Current interpretation of the third chart

The current implementation is reasonable if understood as:

- heart rate:
  - a sampled BPM signal used for visual comparison
- speed:
  - the fine-grained Google Fit speed signal

The chart is therefore useful for:

- comparing trend
- comparing timing
- checking whether speed changes and heart-rate changes roughly move together

It is **not** intended to prove exact sensor-level synchronization.

## Why this note exists

Without this clarification, a future maintainer may start from a misleading assumption such as:

- "heart rate must be truly raw 1-second COROS data"
- "the speed chart must be derived from distance because the source name contains `dist`"
- "the chart is invalid unless both series share exactly the same physical sampling model"

Those assumptions are not necessary for the product goal of this chart.

The current design is acceptable because:

- heart-rate BPM samples are sufficient for comparison
- speed matches the Google Fit speed/pace interpretation
- the chart is for practical visual analysis, not strict sensor-forensics
