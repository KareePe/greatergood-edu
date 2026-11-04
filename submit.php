<?php
/* Shared enquiry form endpoint — records each lead with its source. */
declare(strict_types=1);
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

function field(string $key, int $max = 200): string {
    $v = isset($_POST[$key]) && is_string($_POST[$key]) ? trim($_POST[$key]) : '';
    $v = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v) ?? '';
    return mb_substr($v, 0, $max);
}

// Honeypot: bots fill the hidden "website" field. Pretend success.
if (field('website') !== '') {
    respond(200, ['ok' => true]);
}

$name   = field('name', 120);
$phone  = field('phone', 20);
$email  = field('email', 160);
$status = field('status', 40);
$phoneDigits = preg_replace('/[\s\-().]/', '', $phone) ?? '';

$errors = [];
if (mb_strlen($name) < 2) $errors[] = 'name';
if (!preg_match('/^(\+?66|0)\d{8,9}$/', $phoneDigits)) $errors[] = 'phone';
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'email';
if (!in_array($status, ['', 'student', 'working_professional', 'business_owner', 'other'], true)) $status = 'other';
if ($errors) respond(422, ['ok' => false, 'error' => 'validation', 'fields' => $errors]);

$lead = [
    'submitted_at'     => (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('Y-m-d H:i:s'),
    'name'             => $name,
    'phone'            => $phone,
    'status'           => $status,
    'email'            => $email,
    'marketing_opt_in' => field('marketing_opt_in') === 'yes' ? 'yes' : 'no',
    'lang'             => field('lang', 5) === 'en' ? 'en' : 'th',
    'lead_source'      => field('lead_source', 40) ?: 'direct',
    'utm_source'       => field('utm_source', 100),
    'utm_medium'       => field('utm_medium', 100),
    'utm_campaign'     => field('utm_campaign', 150),
    'utm_content'      => field('utm_content', 150),
    'utm_term'         => field('utm_term', 150),
    'referrer'         => field('referrer', 500),
    'landing_page'     => field('landing_page', 500),
    'user_agent'       => mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300),
];

/* 1) Always save locally (CSV, Excel-friendly UTF-8 BOM) */
$dir = __DIR__ . '/data';
if (!is_dir($dir)) @mkdir($dir, 0750, true);
$file = $dir . '/leads.csv';
$isNew = !file_exists($file);
$fh = @fopen($file, 'ab');
if (!$fh) respond(500, ['ok' => false, 'error' => 'storage']);
flock($fh, LOCK_EX);
if ($isNew) { fwrite($fh, "\xEF\xBB\xBF"); fputcsv($fh, array_keys($lead)); }
// neutralise spreadsheet formula injection
$safe = array_map(fn($v) => preg_match('/^[=+\-@\t\r]/', (string)$v) ? "'" . $v : $v, $lead);
fputcsv($fh, array_values($safe));
flock($fh, LOCK_UN);
fclose($fh);

/* 2) Forward to Google Sheet (optional) */
if (GOOGLE_SHEET_WEBHOOK !== '' && function_exists('curl_init')) {
    $ch = curl_init(GOOGLE_SHEET_WEBHOOK);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($safe, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 8,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

/* 3) E-mail notification (optional) */
if (NOTIFY_EMAIL !== '') {
    $body = '';
    foreach ($lead as $k => $v) $body .= "$k: $v\n";
    @mail(NOTIFY_EMAIL, '=?UTF-8?B?' . base64_encode('New HMM enquiry: ' . $name) . '?=', $body, "Content-Type: text/plain; charset=UTF-8");
}

respond(200, ['ok' => true]);
