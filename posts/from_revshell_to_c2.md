---
title: From a C# reverse shell to Blackiron
date: 2026-04-07
tag: MALWARE
description: My journey from 50 lines of socket code to a Windows agent that stopped treating execution like the finish line.
---

# From a C\# reverse shell to Blackiron

My first malware-related project was a small C# reverse shell. It connected back, ran commands, and disappeared as soon as Microsoft Defender inspected it.

That failure was useful. I had concentrated on execution and ignored almost everything that made the executable easy to classify: imports, strings, configuration, process behavior, and traffic. Getting code to run was only the first step.

## The artifact confessed

My only metric at the time was whether the payload ran. The defender had better questions:

_Does this binary look fake? Does it advertise suspicious intent? Does the process behavior make sense? Does the traffic make sense? Does any of this belong on this host?_

My shell answered all of those badly.

The binary contained plaintext network configuration, obvious imports, and descriptive strings. Static inspection could explain much of it before execution began.

That changed how I evaluated the project. I still needed the code to work, but I also needed to understand what the binary disclosed and what its behavior looked like from the defender's side.

## Turning failure into a checklist

_How does the PE get inspected? What does the import table reveal? What gets hooked or logged? Where do AMSI and ETW fit? Which telemetry sources can I observe and reproduce in the lab?_

Each answer opened another question. The list became a practical checklist of surfaces I could inspect and test.

If the PE looked unusual on disk, I examined the static indicators. If imports revealed too much, I tested runtime resolution. Fixed beacon intervals led me to jitter, while broken sessions taught me to treat output as part of the protocol rather than as an arbitrary string.

## Reducing static clues

The first changes addressed information exposed directly by the binary. Runtime resolution reduced obvious imports without changing the fact that the calls would still happen at runtime. I applied the same reasoning to DLL names, API names, process names, URLs, and addresses embedded as strings.

The bigger shift was understanding that disk hygiene and runtime behavior are separate problems. A cleaner static artifact can still produce conspicuous memory and process activity.

Improving the static artifact helped, but it could not compensate for conspicuous runtime behavior.

## Choosing techniques by context

Process hollowing was interesting to implement because it forced me to understand process creation and image replacement. It also has a recognizable behavioral shape under mature monitoring.

The result can include unusual process state, private executable memory, and execution moving into a process that does not normally exhibit that behavior.

A technique can be elegant and still be a poor choice for a particular environment. I started treating each primitive as one tradeoff inside a larger execution chain rather than as a general answer to detection.

## Building Blackiron

All of that pushed me toward Blackiron.

A custom C2 is not automatically useful. I built Blackiron because the reverse shell exposed problems that a single socket loop could not solve: session state, task boundaries, partial output, reconnects, and coordination between modules.

Rust mattered because it changed the constraints of the build. I had to consider imports, strings, traffic shape, beacon timing, and what remained visible during inspection.

And that led to a Rust agent with a `#![no_std]` build, encrypted tasking, jittered intervals, and explicit choices around networking and persistence.

The `#![no_std]` build reduced runtime support and made more allocation, error-handling, and platform decisions explicit.

One of those decisions involved the import table. Blackiron resolves sensitive calls at runtime through a PEB walk and hashed export names. This removes several immediate clues from the import directory, although it does not hide the calls or their effects at runtime.

Sending a command over a socket is straightforward. Keeping the session reliable around that command was harder.

Blackiron had to handle the cases screenshots hide: stable identity, large or malformed output, dead connections, competing result streams, and modules failing without taking the session down.

The task shape stayed simple on purpose:

```text
session -> task -> chunked result -> ack -> next sleep
```

The loop looks simple until it is tested with large output, slow networks, failed modules, and partially disconnected sessions. Those cases forced the protocol to become explicit.

There are three problems inside that loop and they have to stay separated.

Transport: _does the traffic shape survive inspection?_
Session: _does identity survive connection drops?_
Task: _does a task failing cleanly leave the session alive?_

Each one fails differently. Each one has to be able to fail without dragging the others down.

My original shell collapsed all three into one loop. It failed when output grew too large, the network dropped during a write, or a module error propagated into the session. Separating the responsibilities made those failures easier to contain and test.

That was the first time it stopped feeling like a toy.

The server side stayed deliberately small. Most of the engineering work happened in the agent loop, where shortcuts around state and error handling became visible quickly.

I stopped asking only whether it connected and started testing what the complete chain exposed to endpoint monitoring.

## What I learned

The jump from a toy reverse shell to Blackiron had very little to do with code volume.

The main change was replacing a binary success metric with questions about reliability and observability.

_What does this look like to the defender?_

That question changed the work. The project became a systems-engineering exercise evaluated from both sides of the endpoint.

Most of the progress came from broken sessions, malformed output, timing that was too regular, and features that failed outside their original test case.

That shift is how a disposable shell turned into Blackiron.

The result is still a work in progress, but it is no longer a reverse shell with extra features attached.
