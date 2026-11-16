# AMPLE

**A**pache · **M**ariaDB · **P**HP · **L**ogs · **E**lectron

A clean local PHP development server for Windows. It's like XAMPP, but kept up to date, with sensible config and logs you can read.

## Folders

| Folder | What's inside |
|---|---|
| `htdocs\` | **Your PHP projects go here.** `htdocs\myapp\` opens at http://localhost/myapp/ |
| `apache\` | Apache web server. Config: `apache\conf\httpd.conf` |
| `apache\conf\vhosts\` | Your own virtual hosts (one `.conf` file each). Kept when Apache is upgraded |
| `php\8.5.12\` | PHP, with one folder per version. Config: `php\<version>\php.ini` |
| `mariadb\` | MariaDB database server. Config: `mariadb\my.ini` |
| `mariadb\data\` | **Your databases.** Kept when MariaDB is upgraded |
| `phpmyadmin\` | phpMyAdmin, at http://localhost/phpmyadmin/ |
| `mailpit\` | Mailpit: catches every email PHP sends, at http://localhost/mailpit/ (stored in `mailpit\data\`, kept on upgrade) |
| `electron\` | Runs the control panel (`AMPLE.exe`, open it with `ample panel`). Downloaded by setup |
| `logs\` | All logs in one place: `apache\`, `php\`, `mariadb\`, `ample\` |
| `bin\` | Launchers for `php`, `composer`, `mysql`, `mysqldump`, `ample` (always the active versions). `ample path add` puts it in your PATH |
| `backups\` | Created when you run `ample backup` or `ample rescue` |
| `tmp\` | Temporary files (sessions, uploads, downloads). Safe to delete while stopped |
| `control\` | AMPLE itself: control panel, command line, config templates |
| `ample.json` | Your settings (ports, active PHP version, MariaDB password) |

## Commands

Open a terminal in this folder:

```
ample panel             open the control panel (window)
ample start             start MariaDB, Apache and Mailpit
ample stop              stop them (MariaDB shuts down cleanly)
ample restart
ample status
ample start apache      only one service (apache, mariadb, mailpit)

ample doctor            explain the problems in the logs (English / Arabic)
ample doctor 3          details + how to fix problem 3
ample doctor fix 3      apply the automatic fix for problem 3
ample lang ar|en        language of the explanations

ample php-list          installed PHP versions
ample php-add 8.6       download another PHP version
ample php-compare 8.6   compare it with the current version (changes nothing)
ample php-use 8.6       switch, carrying over your extensions and settings
ample password <pw>     change the MariaDB password everywhere at once

ample db                list your databases (tables, size on disk)
ample backup [db...]    export to backups\<db>-<date>.sql.gz (all databases if none given)
ample import file [db]  import .sql / .sql.gz / .zip of any size, with progress
ample rescue            MariaDB won't start? rescue your databases into a fresh data folder

ample path add          run php, composer, mysql, ample from any terminal (your user PATH, no admin)
ample path remove       undo it

ample xdebug on|off     step debugging; downloads the Xdebug build that matches the active PHP
ample setup             download / repair all components

ample update            check every component against its official source (changes nothing)
ample update all        update everything that has a new version
ample update mariadb    or one component: apache, php, mariadb, phpmyadmin, mailpit, composer, cacert, xdebug
```

Updates are safe: every download is checked against its official SHA-256; your data (`mariadb\data`, `apache\conf\vhosts`, `apache\conf\ssl`, `mailpit\data`) is kept; if a new Apache/Mailpit doesn't start, the old version is restored automatically; MariaDB gets a temporary copy of its data folder that is restored on failure and deleted on success. A new PHP patch is installed next to the old one and switched to with your settings carried over. New versions are written to `control\components.json`, so `ample setup` on another PC installs the same ones.

## Sites: NAME.localhost

Every folder in `htdocs` is its own site, with no setup and no admin rights:

| Folder | Address |
|---|---|
| `htdocs\shop\` | http://shop.localhost/ |
| `htdocs\my-laravel-app\` (has `artisan` + `public\`) | http://my-laravel-app.localhost/ (serves `public\` automatically) |
| any folder | still also at http://localhost/FOLDER/ like XAMPP |

A new folder works immediately, even while Apache runs. Folder names must be letters, digits and hyphens (`ample sites` tells you what to rename). `ample sites` lists everything.

Browsers and curl understand `*.localhost`; Windows' own lookup (`file_get_contents`, `fsockopen`) does not, so call local sites from PHP with curl or via `http://localhost/FOLDER/`.

## HTTPS

```
ample https on          https://localhost and https://NAME.localhost
ample https trust       trust AMPLE's local CA (Windows asks you to confirm once, no admin)
ample https untrust     remove that trust again
ample https off
```

The local certificate authority is created on your PC and is limited by X.509 name constraints to `localhost`, `*.localhost`, `127.x` and `::1`, so even if its key were stolen it could not be used to fake a real website. The site certificate is renewed automatically when you add folders. Windows' built-in `curl.exe` needs `--ssl-no-revoke` for local certificates; browsers and PHP don't.

## Email (Mailpit)

Every email your code sends stays on your PC and shows up at http://localhost/mailpit/. PHP's `mail()` works with no setup. For frameworks use SMTP `127.0.0.1:1025` (any username/password), e.g. Laravel `.env`: `MAIL_MAILER=smtp`, `MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`.

## Log Doctor

`ample doctor` reads all logs, recognises known problems and explains each one: what happened, common causes, step-by-step fix, and often a one-click fix (raise a PHP limit, enable an extension, pick a free port, repair MariaDB's Aria files after an unclean shutdown...). Repeated errors are grouped, and problems that stopped a service are hidden once the service starts again.

## Is this PC ready? (`ample check`)

`ample check` tests Windows (64-bit / ARM), the Visual C++ runtime Apache and PHP need, Windows Smart App Control (and which AMPLE files it blocked), whether every program really runs, Microsoft Defender, the folder location (non-English characters, spaces, OneDrive), ports and disk space, and explains each problem with a fix.

**Smart App Control:** AMPLE's components (Apache, PHP, MariaDB, Mailpit) are open-source builds that are not digitally signed. When Smart App Control is on, Windows blocks unsigned files that are still new, so a release from last week may be blocked while older ones run. You don't have to turn it off: `ample update` tests every new version before using it and keeps the current one if Windows blocks it (try again a few weeks later). Turning Smart App Control off is only ever your own choice.

**Defender:** real-time scanning of every PHP, database and log file can slow big projects. `ample check --fix defender` excludes the AMPLE folder (asks for administrator once); then keep only your own projects there.

## Moving from XAMPP

AMPLE never writes into the XAMPP folder: projects are copied, and databases are exported from a temporary COPY of `mysql\data`, opened with XAMPP's own MariaDB. Every step shows a plan first and only acts with `--yes`.

```
ample xampp scan                          what can be imported + Log Doctor on XAMPP's logs (read-only)
ample xampp import projects [a,b] --yes   copy htdocs projects (existing AMPLE folders are never overwritten)
ample xampp import databases --yes        stop MySQL in XAMPP first; databases + non-root users and grants
ample xampp import php 1,3 --yes          pick which of YOUR php.ini changes to keep
ample xampp import vhosts --yes           httpd-vhosts.conf -> apache\conf\vhosts (+ NAME.localhost alias)
ample xampp undo --yes                    remove everything imported (XAMPP is untouched anyway)
```

Only `mysql\data` is imported (other copies such as `data_backup` are ignored). Accounts `@localhost` are also created `@127.0.0.1` and `@::1`, because AMPLE's MariaDB doesn't resolve host names and PHP on Windows connects to "localhost" through 127.0.0.1. XAMPP in another folder: `ample xampp scan --path=D:\xampp`.

## When MariaDB won't start

1. `ample doctor` explains why. For the classic "damaged Aria log" case it offers an automatic repair.
2. If that is not enough: `ample rescue --yes`. It moves the broken `mariadb\data` aside (nothing is deleted), starts MariaDB on a fresh data folder, opens the broken copy with a temporary recovery server, exports every database it can read to `backups\rescue-<date>\`, imports them into the fresh MariaDB, and reports what was saved.

Never copy `mysql\backup` or single database folders over your data like the old XAMPP trick; that mixes files from different moments and causes hidden damage.

## Editing php.ini

You can edit `php\<version>\php.ini` by hand like in XAMPP. On the next start AMPLE notices your edits, saves them in `ample.json`, and keeps them, including when you switch PHP versions.

## Config files

`httpd.conf`, `php.ini`, `my.ini` and phpMyAdmin's `config.inc.php` are **regenerated on every start**, built from `ample.json` and the templates in `control\templates\`. Edit the templates or use the control panel; edits made directly in the generated files are overwritten.

## Logs

| File | Contains |
|---|---|
| `logs\apache\access.log` | Every request: `2026-11-13 14:02:11 \| 200 \| GET /index.php \| 12 ms \| 3120 B \| 127.0.0.1` |
| `logs\apache\error.log` | Apache + PHP fatal errors, with time, module, level, client |
| `logs\php\error.log` | PHP errors, warnings, deprecations |
| `logs\mariadb\error.log` | MariaDB start/stop/errors |
| `logs\mariadb\slow.log` | Queries slower than 2 seconds |
| `logs\ample\ample.log` | What AMPLE did: start, stop, port conflicts, setup |

Logs are never rotated or archived. When everything works, empty them so the next problem is the only thing you see:

```
ample logs              list log files and sizes
ample logs clear        empty all logs (safe while Apache/MariaDB are running)
ample logs clear php    only one: apache, php, mariadb, ample
```
