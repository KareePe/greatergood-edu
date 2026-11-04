<?php
/*
 * Lead form settings (PHP hosting only, e.g. XAMPP — Firebase Hosting does not run PHP).
 *
 * Values come from .env (never committed or served; template: .env.example).
 * A real server environment variable with the same name takes priority over .env.
 *
 * Every submission is always saved to data/leads.csv (blocked from the web by data/.htaccess).
 */

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
function gged_env(string $key, string $default = ''): string
{
    static $vars = null;
    if ($vars === null) {
        $vars = [];
        $file = __DIR__ . '/.env';
        if (is_readable($file)) {
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') continue;
                if (!preg_match('/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $line, $m)) continue;
                $value = trim($m[2]);
                if (preg_match('/^([\'"])(.*)\1$/', $value, $q)) {
                    $value = $q[2];
                } else {
                    $value = preg_replace('/\s+#.*$/', '', $value);
                }
                $vars[$m[1]] = $value;
            }
        }
    }
    $real = getenv($key);
    if ($real !== false && $real !== '') return $real;
    return $vars[$key] ?? $default;
}

/* Google Sheet: Apps Script web app URL (setup steps at the top of google-apps-script/Code.gs). */
define('GOOGLE_SHEET_WEBHOOK', gged_env('GOOGLE_SHEET_WEBHOOK'));

/* Optional: e-mail address to notify on each new lead (requires a working mail() setup). */
define('NOTIFY_EMAIL', gged_env('NOTIFY_EMAIL'));
