---
title: "The Reverse Engineering Gauntlet"
description: "Breaking down SpookyPass, Simple Encryptor, Behind The Scenes, and the ARMs Race. Plus, explaining reverse engineering like you're 5."
date: 2026-07-25
tags: ["reverse-engineering", "linux", "arm", "cryptography", "binary-exploitation"]
authors: ["0xakr4m"]
image: ../images/headers/vagabond-rechall.png
draft: false
---

> "Perception is strong and sight weak. In strategy it is important to see distant things as if they were close and to take a distanced view of close things." — Miyamoto Musashi, *Vagabond*

What's good, cyber ronins? We're taking a detour from web apps and network hacking today to look at something that actually hurts your brain: **Reverse Engineering (RE)**. 

Bro, the impostor syndrome hit hard on this one. I thought I was hot stuff after solving the first challenge, but this gauntlet humbled me real quick. We had four challenges: SpookyPass, Simple Encryptor, Behind the Scenes, and ARMs Race. 

Since RE can feel like reading the Matrix, I'm going to break down the core concepts like you're 5 years old (ELI5 style), so even the youngest skids can follow along. Grab your katanas, let's get into it. 🗡️

## 1. Quick Info Card (The Bootcamp Roster)

| Challenge | Type | Difficulty | Key Vulnerability |
|-----------|------|------------|-------------------|
| **SpookyPass** | Linux ELF | Easy | Hardcoded plaintext password / `ltrace` abuse |
| **Simple Encryptor** | Linux ELF | Easy-Medium | Reversible XOR + Bit Rotation with a static seed |
| **Behind the Scenes**| Linux ELF | Medium | Signal obfuscation (SIGILL) and chunked `strncmp` |
| **ARMs Race** | Network ARM | Medium-Hard| Custom ARM code execution |

## 2. The Game Plan & The Rabbit Holes (Red Teamer Mindset)

We started with **SpookyPass**. Easy win. Open it in `ltrace`, see the `strcmp` (string comparison), grab the password. Done. I was feeling like a god.

Then **Simple Encryptor** punched me in the face. I ran `strings` and found nothing. I ran `ltrace` and saw a bunch of random calls, but no comparison. Wait, why is the encrypted file 25 bytes when the input is 21? That 4-byte header was the timestamp! Absolute facepalm moment. I spent way too long trying to brute-force the key before I opened Ghidra (a reverse engineering tool) and saw the XOR and bit rotation logic. My brain melted trying to reverse that loop.

Next, **Behind the Scenes**. The name was a massive red flag, but I ignored it. I loaded it up, and it crashed instantly. I thought I broke my VM. I saw `ltrace` throwing SIGILL errors and assumed the binary was broken. After an hour of banging my head against the wall, I realized it was a fake crash. The developer hid the real code after an illegal instruction. Ghidra gave me an empty main, and I thought it was over. Then I remembered `objdump` doesn't care about your fake crashes. The real code was sitting right there in raw assembly.

Finally, **ARMs Race**. Man, this is where I completely over-engineered the solution. The server threw hex strings at me. I thought: "Alright, time to build a full ARM CPU emulator in Python." No cap, I spent 4 hours writing a 200-line monster that failed miserably. The lesson? Don't build the whole car when you just need to drive to the corner store. 

---

## 3. The Execution (Step-by-Step Walkthrough)

### Chapter 1: SpookyPass

> **ELI5 - What is an ELF file and `ltrace`?**
> Imagine a video game cartridge for an old console. For Linux, an ELF file is basically the game cartridge—it holds all the instructions the computer needs to run the program.
> 
> Now, what if you wanted to see the secret instructions the game is sending to the console? That's what `ltrace` does! It acts like a wiretap, listening to the program every time it asks the operating system (or "library") to do something, like checking if two passwords match.

**Recon & Weaponization:**
We confirmed the file was an ELF executable. Running `strings` gave us the prompt, but not the password. 

The password was long and got truncated by `ltrace` by default. Rookie mistake. We ran it with a bigger string size:
```bash
ltrace -s 200 ./pass
```

Inside the output, it showed the exact password check:
```text
strcmp("f", "s3cr3t_p455_f0r_gh05t5_4nd_gh0ul5") = -13
```

Typing `s3cr3t_p455_f0r_gh05t5_4nd_gh0ul5` got us `HTB{un0bfu5c4t3d_5tr1ng5}`. Trivial.

### Chapter 2: Simple Encryptor

> **ELI5 - What is XOR and Bit Rotation?**
> Imagine you have a secret message. 
> - **XOR** is like a magic light switch. If you flip it once, the message turns to gibberish. If you flip it *exactly the same way* a second time, it turns back into your secret message! 
> - **Bit Rotation** is like having your letters written on a combination lock dial. If you spin it to the left to hide the message, you just spin it back to the right to read it again. 
> 
> As long as you know how the magic switch was flipped (the "seed"), you can easily undo it!

**Recon & Weaponization:**
Running `./encrypt` segfaulted. `ltrace` showed it was looking for a file named `flag`. We created a dummy flag file to see the encryption at work. 

We dumped the header of the encrypted file: `xxd flag.enc`. The first 4 bytes were the timestamp. The code reads the file, seeds the random generator with the time, writes the seed, and then for each byte, it XORs it and rotates the bits left.

**The Reversal:**
We wrote Python to reverse the rotation (rotate right) and XOR again.
```python
import ctypes, struct
libc = ctypes.CDLL(None)
data = open("flag.enc", "rb").read()
seed = struct.unpack("<I", data[:4])[0]
libc.srand(seed)
enc = data[4:]
dec = bytearray()
for b in enc:
    r1 = libc.rand()
    r2 = libc.rand()
    amt = r2 & 7
    # Reverse the rotation (rotate right)
    b = ((b >> amt) | (b << (8 - amt))) & 0xFF
    # Reverse the XOR
    b ^= (r1 & 0xFF)
    dec.append(b)
print(dec)
```
Output: `HTB{vRy_s1MplE_F1LE3nCryp0r}`.

### Chapter 3: Behind the Scenes

> **ELI5 - What is a SIGILL (Illegal Instruction) and Assembly?**
> Imagine reading a book out loud to the class. Suddenly, there is a word in an alien language that you literally cannot pronounce. You'd probably freeze and say "I crash!" That alien word is an **Illegal Instruction (SIGILL)**.
> 
> **Assembly code** is basically the raw alien language of the computer. Usually, tools like Ghidra translate it back to English for us. But the developer put a fake "alien word" in the code on purpose. Ghidra got confused and stopped translating. But the real English text was just hiding on the next page!

**Recon & Weaponization:**
Running the program gave a `SIGILL` and crashed. It was a trap! The developer set a signal handler that just skipped the illegal instruction and moved on, hiding the real code from decompilers.

We used `objdump` to look at the raw assembly:
```bash
objdump -d -M intel behindthescenes | sed -n '/<main>:/,/^$/p'
```

The real code was there, checking the password in chunks of 3 characters using `strncmp` (string compare). We read the bytes at the memory addresses it was checking:
```bash
xxd -s 0x201b -l 12 behindthescenes
0000201b: 4974 7a00 5f30 6e00 4c79 5f00 5544 3200
```
ASCII chunks: `Itz`, `_0n`, `Ly_`, `UD2`.
We assembled the password: `Itz_0nLy_UD2`.
Flag: `HTB{Itz_0nLy_UD2}`.

### Chapter 4: ARMs Race

> **ELI5 - What is ARM and CPU Emulation?**
> CPUs are the brains of computers, and they speak different languages. Your laptop speaks "x86", but your phone (or a Raspberry Pi) speaks "ARM". 
> 
> **Emulation** is like having a translator in your brain. If you want your laptop to run a phone app, you have to build a fake phone brain (an emulator) inside your laptop. For this challenge, I tried building a whole fake brain, when all I really needed was a simple calculator. 

**Recon & Weaponization:**
The server was spitting out stripped ARM assembly in hex format, and we had to calculate the final value of Register 0 (`r0`). 

I tried to write a full ARM emulator and failed. The real solution? Just look for the specific math operations (add, subtract, multiply) and do them in Python using a disassembler library called Capstone.

```python
from capstone import *
def HexToArm(data):
    cs = Cs(CS_ARCH_ARM, CS_MODE_ARM)
    dis = [f"{i.mnemonic} {i.op_str}" for i in cs.disasm(bytes.fromhex(data), 0)]
    R0, R1, R2 = 0, 0, 0
    for line in dis:
        if "mov" in line:
            if "#" in line:
                val = int(line.split("#")[1], 16)
                if "r0" in line: R0 = val
                elif "r1" in line: R1 = val if "movw" in line else R1 + (val << 16)
                elif "r2" in line: R2 = val if "movw" in line else R2 + (val << 16)
        
        if "r0, r0" in line:
            if "add" in line: R0 += R1 + R2
            elif "sub" in line: R0 = (R0 - R1 - R2) + 0xFFFFFFFF
            elif "mul" in line: R0 *= R1 * R2
            elif "eor" in line: R0 ^= R1 ^ R2
            elif "and" in line: R0 &= R1 & R2
            elif "orr" in line: R0 |= R1 | R2
            elif "rsb" in line: R0 = 0x100000000 - R0
    return hex(R0 & 0xFFFFFFFF)
```

We automated this over a socket connection for 50 levels and got the flag: `HTB{un1c0Rn_0R_C4p5T0nE...}`.

---

## 4. How to Patch This (The Blue Team Defense)

1. **Hardcoded Secrets (SpookyPass)**
Don't store passwords in plaintext in the binary. Hardcoded credentials are searchable via `strings`. Use a hashing algorithm (like bcrypt or Argon2) on the server-side and compare hashes.

2. **Weak Encryption (Simple Encryptor)**
XOR is trivial to crack if you know the seed. In this case, the seed was stored in the file itself. Use established cryptographic libraries (OpenSSL) with secure key derivation. Don't roll your own crypto!

3. **Obscurity & Signal Handling (Behind the Scenes)**
Obfuscating execution flow with fake crashes (SIGILL) does not stop static analysis. A determined attacker will just dump the assembly. Rely on server-side validation, not client-side secrets.

4. **Automated Code Execution (ARMs Race)**
This server was a remote math engine with no rate limiting. Implement a timeout and lockout mechanism. If someone fails 5 times, drop the connection.

## 5. Final Thoughts

> "Today is victory over yourself of yesterday; tomorrow is your victory over lesser men." — Miyamoto Musashi

This gauntlet was a test of patience and adaptability. We started with simple tool dumping, evolved into binary analysis, and finished with full system automation. The real victory wasn't the flags—it was learning when to stop over-engineering and just write the simple, hacky code that wins the race. 

Stay curious, keep reversing, and don't build a whole car just to go to the corner store. ✌️
