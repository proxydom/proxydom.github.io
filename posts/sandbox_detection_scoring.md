---
title: How I detect sandboxes without calling a single suspicious API
date: 2026-04-07
tag: MALWARE
description: Why I moved from single anti-VM checks to a calibrated score built from several weak environmental signals.
---

# How I detect sandboxes without calling a single suspicious API

My first sandbox checks relied on familiar artifacts: a DLL name, a registry key, or a process associated with a virtual machine. They worked in a narrow lab setup and became unreliable as soon as the environment changed.

When I added environment checks to my agent, I moved away from trying to prove that the host was a VM. A developer workstation can be virtualized, while an analysis environment can imitate physical hardware. The more useful question was whether several independent properties made automated analysis likely enough to change the agent's behavior.

## One signal is not enough

Automated analysis environments may expose weak signals such as limited hardware, a small disk, a simple display profile, little user activity, or unusual timing behavior. None of those is proof.

Two CPU cores can describe a sandbox, a cheap laptop, a CI runner, or a developer VM. Cursor movement can come from a real user or synthetic input. Even short uptime is common after a legitimate reboot.

Environmental scoring combines that uncertainty instead of promoting one artifact to a verdict. The score is not a sandbox detector by itself; it is an input to a decision about how much behavior the agent should expose.

## The score

This is the rough model I currently use in the lab:

| Signal family | Weight | What I measure |
| --- | ---: | --- |
| Hardware profile | 25 | Core count, RAM, disk size, and GPU information. One constrained resource is common; a consistently minimal profile is more interesting. |
| Display and desktop | 10 | Resolution, monitor count, and properties expected from the target workstation population. |
| User presence | 25 | Recent input, uptime, files, and browser history. Fresh and shared systems can also look sparse. |
| Timing behavior | 20 | Differences between requested delays and observed time across more than one clock source. |
| Process context | 10 | Parent process, command line, token, session, and path. |
| Network context | 10 | DNS behavior, background traffic, and whether egress resembles the rest of the environment. |

These are example weights from my notes, not universal values. They reflect the systems in my test set and need to move when that set changes.

Under `30`, the agent continues normally. From `30` to `59`, it reduces optional activity. At `60+`, it remains idle. I use three outcomes because a binary run-or-exit decision made false positives unnecessarily expensive.

## Timing without magic numbers

Timing checks were useful in my lab, but they are easy to overstate. An analysis system can alter both the requested delay and the clock used to measure it. Ordinary scheduling load can push the result in the other direction.

The basic measurement is simple:

```c
LARGE_INTEGER delay = { .QuadPart = -5000000LL }; // 500ms in 100ns units
ULONGLONG before = GetTickCount64();
NtDelayExecution(FALSE, &delay);
ULONGLONG after = GetTickCount64();

record_delay_sample(after - before);
```

The important part is what happens after this code. I collect several samples, compare more than one time source, and evaluate the distribution against known machines. I deliberately avoid a universal `RDTSC` threshold: CPU model, power state, virtualization configuration, and serialization method can all change the result. A number copied from somebody else's hardware is more likely to classify the hardware than the sandbox.

## Combining the signals

The implementation stays deliberately small:

```text
score = 0
score += hardware_profile()
score += desktop_shape()
score += user_presence()
score += timing_sanity()
score += process_context()
score += network_context()

if score >= hard_line:
    stay_idle()
else if score >= soft_line:
    reduce_optional_activity()
else:
    continue_normally()
```

No single function owns the decision. Each function returns a contribution and enough diagnostic information for me to understand why the score moved.

That diagnostic output matters during testing. Without it, tuning becomes guesswork and a false positive only tells me that the total was wrong.

## Calibration

A developer VM exposed the biggest flaw in my first version. It had little RAM, one display, and almost no desktop activity, so the initial score classified it as suspicious. Its uptime, browsing residue, and normal process context moved it back below the threshold.

That result stopped me from treating "VM-looking" as equivalent to "analysis-looking."

I now keep a small set of known systems and record false positives for each change. The set includes physical workstations, development VMs, fresh installations, and the analysis environments available in my lab. One unusual result does not immediately change a weight, but repeated misses do.

Calibration also needs a target population. A kiosk, a developer laptop, and an employee workstation have different normal profiles. A model tuned on my desktop should not be presented as a general detector for all three.

## Responding to the score

If the score crosses the high threshold, the agent remains idle rather than exiting immediately. An immediate exit is itself observable and makes the decision easy to classify. Idling exposes less behavior, although the process lifetime and environment checks may still be visible.

Medium suspicion produces a smaller response: slower tasking, less output, and fewer optional actions. This keeps the response proportional and gives borderline systems a different path from strong matches.

The checks also have a cost. Querying dozens of famous VM artifacts can make the detector more distinctive than the behavior it is trying to protect. I therefore keep the input set small and treat cursor movement, process names, and registry artifacts as weak contributions rather than proof.

## Limits

A well-configured analysis environment with realistic hardware, user simulation, consistent clocks, and representative background activity can pass this model. That is expected.

The purpose is narrower: combine several weak signals, measure their error rate, and avoid relying on one brittle anti-VM check. Environmental scoring is useful only when the weights come from testing. Without that data, it is just a longer checklist with numbers attached.
