---
title: A signed driver does not mean a trusted driver
date: 2026-05-31
tag: WINDOWS
description: Why vulnerable drivers turn local admin into a kernel problem, and why the real work starts at the IOCTL surface.
---

# A signed driver does not mean a trusted driver

A code signature establishes the origin and integrity of a driver package. It does not establish that every interface exposed by the driver is safe for hostile input.

That distinction is the basis of BYOVD: bring your own vulnerable driver. An attacker with sufficient privileges loads a legitimately signed but vulnerable driver, opens its device object, and uses an exposed operation to perform work from kernel mode.

The signature is valid. The interface is the problem.

## What I inspect first

My first pass follows the path from userland to the handler:

```text
entry point -> device setup -> ACL -> dispatch -> IOCTL decode -> handler
```

I start with the device name, symbolic link, device object security descriptor, unload path, and dispatch table. For device-control requests, I locate `IRP_MJ_DEVICE_CONTROL` or the corresponding WDF queue callback and map each control code to its handler.

The control code describes two properties that matter immediately: the required access bits and the buffering method.

```c
#define IOCTL_DO_THING \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_NEITHER, FILE_ANY_ACCESS)
```

`FILE_ANY_ACCESS` does not bypass the device object's ACL. The caller still needs a handle to the device. It means the I/O manager does not require that handle to have additional read or write access before sending this IOCTL. For a powerful operation, that is a reason to examine both the device ACL and any checks performed by the handler.

`METHOD_NEITHER` passes user-space virtual addresses without the I/O manager copying, locking, or mapping the buffers. A safe handler must validate the address range and access, run in an appropriate caller context, and protect later accesses with exception handling because another thread can change the mapping after the initial probe.

`METHOD_BUFFERED` is not automatically safe either. The I/O manager can copy the outer buffer correctly while the driver still trusts attacker-controlled sizes, offsets, embedded pointers, handles, or target identifiers inside it.

## Reaching the handler

Userland normally reaches the device through `CreateFile` and `DeviceIoControl`:

```c
HANDLE hDevice = CreateFileA(
    "\\\\.\\DriverDevice",
    GENERIC_READ | GENERIC_WRITE,
    0, NULL, OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL, NULL
);

DWORD bytesReturned;
DeviceIoControl(
    hDevice, IOCTL_DO_THING,
    inputBuffer, inputSize,
    outputBuffer, outputSize,
    &bytesReturned, NULL
);
```

The existence of an IOCTL is not interesting by itself. The useful question is whether userland can steer a privileged operation through attacker-controlled addresses, sizes, handles, process identifiers, or mode fields.

I use WinObj to inspect the device namespace and access control, WinDbg commands such as `!drvobj` and `!devobj` to inspect runtime objects and dispatch routines, and IDA or Ghidra for the handler body. The tool choice matters less than keeping the path from open to operation intact.

## Candidate is not capability

Public lists such as [LOLDrivers](https://www.loldrivers.io) are useful starting points. A hash, certificate, vendor name, or interesting import can identify a candidate, but none of them proves that a useful primitive is reachable.

Imports such as `MmMapIoSpace`, `ZwOpenProcess`, or `KeStackAttachProcess` show where privileged behavior may exist. The dispatch path still has to prove that an accessible request reaches that behavior with enough caller control to matter.

This distinction prevents a common research mistake: describing a driver as exploitable based on its imports or reputation without tracing the request that reaches the vulnerable operation.

## Where the boundary fails

Many vulnerable drivers were built for legitimate hardware or diagnostic work. They may need physical-memory access, I/O port operations, MSR access, process handles, or other privileged capabilities.

The design becomes dangerous when the user/kernel boundary treats request data as trusted. Typical problems include:

- raw user pointers used without safe validation and exception handling;
- lengths or offsets accepted without checking them against the real buffer;
- caller-controlled kernel addresses passed into read or write operations;
- powerful IOCTLs exposed through permissive device security;
- debug and diagnostic operations left available in production.

The simplified failure is easy to describe:

```text
request selects the target
request supplies the data
driver trusts both
kernel performs the operation
```

The difficult part is determining exactly what the caller controls and whether the behavior is repeatable.

## Primitive quality

Finding one kernel write is not the end of the analysis. I care about its constraints:

```text
narrow primitive   -> one operation with strict target or size limits
useful primitive   -> repeatable read or write with controllable input
strong primitive   -> enough control to adapt across runtime state
reliable primitive -> predictable under build drift and endpoint activity
```

A fragile write that crashes one test VM demonstrates a bug. A reliable primitive needs alignment handling, bounded inputs, predictable errors, and a clear understanding of which assumptions depend on the Windows build.

Modern mitigations also change the environment around the primitive. KASLR affects address discovery. HVCI and WDAC affect which drivers can load. VBS can move security-sensitive state outside the assumptions of older techniques. PatchGuard makes some persistent kernel modifications unstable even when they work initially.

This is why I separate capability from outcome. Local admin plus a driver does not automatically produce SYSTEM or disable a security product. The available primitive, target build, policy, and existing kernel components all constrain what can be done safely and reliably.

## The chain around the driver

The driver is one stage in a larger operation. Loading it can create a service, place a `.sys` file on disk, map a kernel image, and expose a new device object. Talking to it produces a pattern of handle opens and IOCTL requests.

A real implementation therefore needs to answer questions beyond the vulnerable handler:

- Does this driver and vendor belong on the host?
- Can policy load it at all?
- What state remains after a failed attempt?
- Are changes reversible?
- Does cleanup remove an artifact or create a more unusual sequence?

The decision to use a capability can be more important than the capability itself. A stable primitive may still be a poor choice on a host where the driver load and device activity are high-confidence anomalies.

## Defensive visibility

Driver abuse often produces useful signals before the privileged operation occurs. A driver service is created, a kernel image loads, or a known vulnerable hash appears on a machine with no related hardware or software.

Blocklists and application-control policy help only when they are enabled, current, and enforced. WDAC and HVCI can prevent known or non-compliant drivers from loading, but real deployments also accumulate vendor exceptions. Those exceptions need review because the trust decision changes as drivers age and vulnerabilities become public.

The activity around the device can provide stronger context than presence alone:

- Which process opened the device object?
- Did it match the vendor's expected client?
- Which access rights did it request?
- Was the IOCTL sequence normal for that software?
- Did security controls or protected processes change afterward?

A driver load is one event. A driver load followed by a short-lived helper, unusual device access, high-impact state changes, and immediate cleanup is a sequence worth investigating.

## The lesson

Code signing answers who produced a binary and whether it changed after signing. It does not answer whether the driver's design safely handles hostile callers.

For vulnerable-driver research, the useful evidence is in the complete path: who can open the device, which request reaches the handler, what data the caller controls, and what privileged operation the kernel performs on its behalf.

The signature establishes origin. Trust still depends on the code behind the interface.
