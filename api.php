<?php
/**
 * মহেশখালীয়ান (Maheshkhalian) Backend REST API
 * PHP 7.0+ Compatible | PDO SQLite | cPanel Ready
 */
error_reporting(0);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

date_default_timezone_set('Asia/Dhaka');

$baseDir = __DIR__;
$dataDir = $baseDir . '/data';
$dbPath = $dataDir . '/maheshkhalian.db';

if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0755, true);
}

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function getJsonBody() {
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return $_POST;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $_POST;
}

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Auto-migrate optional columns safely
    $extraCols = array(
        "ALTER TABLE posts ADD COLUMN pen_name TEXT DEFAULT ''",
        "ALTER TABLE posts ADD COLUMN union_name TEXT DEFAULT ''",
        "ALTER TABLE posts ADD COLUMN summary TEXT DEFAULT ''",
        "ALTER TABLE posts ADD COLUMN publish_as TEXT DEFAULT 'own'"
    );
    foreach ($extraCols as $sqlCol) {
        try { $pdo->exec($sqlCol); } catch (Exception $ignore) {}
    }
    // Ensure subscribers, uploaded_files & sessions tables exist
    $pdo->exec("CREATE TABLE IF NOT EXISTS uploaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT,
        saved_path TEXT NOT NULL,
        folder_tag TEXT DEFAULT 'general',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
    // Ensure subscribers & sessions tables exist
    $pdo->exec("CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
    // Ensure sessions table exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_type TEXT DEFAULT 'desktop',
        unlocked INTEGER DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
} catch (Exception $e) {
    respond(array('ok' => false, 'error' => 'Database connection failed: ' . $e->getMessage()), 500);
}

function verifyPassword($password, $storedHash) {
    if (strpos($storedHash, 'sha256$') === 0) {
        $parts = explode('$', $storedHash);
        if (count($parts) === 3) {
            $salt = $parts[1];
            $expected = $parts[2];
            return hash('sha256', $salt . $password) === $expected;
        }
    }
    return password_verify($password, $storedHash);
}

function getAuthToken() {
    if (isset($_COOKIE['mk_admin_token']) && $_COOKIE['mk_admin_token'] !== '') {
        return trim($_COOKIE['mk_admin_token']);
    }
    if (isset($_SERVER['HTTP_X_AUTH_TOKEN']) && $_SERVER['HTTP_X_AUTH_TOKEN'] !== '') {
        return trim($_SERVER['HTTP_X_AUTH_TOKEN']);
    }
    if (isset($_GET['token']) && $_GET['token'] !== '') {
        return trim($_GET['token']);
    }
    $body = getJsonBody();
    if (isset($body['token']) && $body['token'] !== '') {
        return trim($body['token']);
    }
    return '';
}

function getCurrentUser($pdo, $requireUnlocked = true) {
    $token = getAuthToken();
    if ($token === '') {
        return null;
    }
    $stmt = $pdo->prepare("SELECT s.*, u.name, u.email, u.photo, u.designation, u.role, u.permissions, u.status
                           FROM sessions s
                           JOIN users u ON u.id = s.user_id
                           WHERE s.token = ? AND s.expires_at > ?");
    $stmt->execute(array($token, time()));
    $row = $stmt->fetch();
    if (!$row || $row['status'] !== 'active') {
        return null;
    }
    if ($requireUnlocked && intval($row['unlocked']) !== 1) {
        return null;
    }
    $perms = json_decode($row['permissions'], true);
    $row['permissions_list'] = is_array($perms) ? $perms : array();
    return $row;
}

function requirePermission($pdo, $permKey = '') {
    $user = getCurrentUser($pdo, true);
    if (!$user) {
        respond(array('ok' => false, 'error' => 'অনুমোদন প্রয়োজন অথবা সেশন মেয়াদোত্তীর্ণ।'), 401);
    }
    if ($permKey !== '' && $user['role'] !== 'super_admin') {
        if (!in_array($permKey, $user['permissions_list'])) {
            respond(array('ok' => false, 'error' => 'আপনার রোলে এই কাজটি করার অনুমতি নেই।'), 403);
        }
    }
    return $user;
}

$action = isset($_GET['action']) ? trim($_GET['action']) : 'bootstrap';

// 1. BOOTSTRAP
if ($action === 'bootstrap') {
    $settingsRows = $pdo->query("SELECT setting_key, setting_value FROM site_settings")->fetchAll();
    $settings = array();
    foreach ($settingsRows as $r) {
        if ($r['setting_key'] === 'time_lock_pin') continue; // never expose PIN publicly
        $settings[$r['setting_key']] = $r['setting_value'];
    }

    $notices = $pdo->query("SELECT * FROM notices WHERE is_active = 1 ORDER BY id DESC")->fetchAll();

    $counts = array(
        'profiles' => intval($pdo->query("SELECT COUNT(*) FROM profiles WHERE status = 'approved'")->fetchColumn()),
        'future'   => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'future' AND status = 'approved'")->fetchColumn()),
        'news'     => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'news' AND status = 'approved'")->fetchColumn()),
        'poems'    => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'poem' AND status = 'approved'")->fetchColumn()),
        'quizzes'  => intval($pdo->query("SELECT COUNT(*) FROM quizzes WHERE status = 'active'")->fetchColumn()),
        'admins'   => intval($pdo->query("SELECT COUNT(*) FROM administration")->fetchColumn())
    );

    // Recent notifications feed
    $notifs = array();
    foreach (array_slice($notices, 0, 3) as $n) {
        $notifs[] = array(
            'id' => 'notice_' . $n['id'],
            'type' => 'notice',
            'title' => $n['title'],
            'body' => $n['body'],
            'time' => $n['created_at']
        );
    }
    $recentNews = $pdo->query("SELECT id, title, created_at FROM posts WHERE category = 'news' AND status = 'approved' ORDER BY id DESC LIMIT 2")->fetchAll();
    foreach ($recentNews as $rn) {
        $notifs[] = array(
            'id' => 'news_' . $rn['id'],
            'type' => 'news',
            'post_id' => $rn['id'],
            'title' => 'ব্রেকিং নিউজ: ' . $rn['title'],
            'body' => 'বিস্তারিত পড়তে ক্লিক করুন',
            'time' => $rn['created_at']
        );
    }

    respond(array(
        'ok' => true,
        'settings' => $settings,
        'notices' => $notices,
        'counts' => $counts,
        'notifications' => $notifs
    ));
}

// 2. PROFILES LIST & FILTERS
if ($action === 'profiles') {
    $isAdmin = isset($_GET['admin']) && $_GET['admin'] === '1';
    if ($isAdmin) {
        requirePermission($pdo, 'profiles');
    }

    $where = array();
    $params = array();

    if (!$isAdmin) {
        $where[] = "status = 'approved'";
    } else if (isset($_GET['status']) && $_GET['status'] !== '' && $_GET['status'] !== 'all') {
        $where[] = "status = ?";
        $params[] = $_GET['status'];
    }

    if (isset($_GET['batch']) && $_GET['batch'] !== '' && $_GET['batch'] !== 'all') {
        $where[] = "ssc_batch = ?";
        $params[] = $_GET['batch'];
    }
    if (isset($_GET['education']) && $_GET['education'] !== '' && $_GET['education'] !== 'all') {
        $where[] = "education LIKE ?";
        $params[] = '%' . $_GET['education'] . '%';
    }
    if (isset($_GET['profession']) && $_GET['profession'] !== '' && $_GET['profession'] !== 'all') {
        $where[] = "profession LIKE ?";
        $params[] = '%' . $_GET['profession'] . '%';
    }
    if (isset($_GET['q']) && trim($_GET['q']) !== '') {
        $q = '%' . trim($_GET['q']) . '%';
        $where[] = "(name LIKE ? OR current_address LIKE ? OR permanent_address LIKE ? OR profession LIKE ? OR education LIKE ? OR future_dream LIKE ?)";
        $params = array_merge($params, array($q, $q, $q, $q, $q, $q));
    }

    $sql = "SELECT * FROM profiles";
    if (count($where) > 0) {
        $sql .= " WHERE " . implode(" AND ", $where);
    }
    $sql .= " ORDER BY CAST(ssc_batch AS INTEGER) DESC, id DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Fetch published quiz results
    $resultsRows = $pdo->query("SELECT qs.*, q.title AS quiz_title FROM quiz_submissions qs LEFT JOIN quizzes q ON q.id = qs.quiz_id WHERE qs.result_published = 1 ORDER BY qs.id DESC")->fetchAll();
    $resultsByProfile = array();
    foreach ($resultsRows as $rr) {
        if ($rr['profile_id']) {
            $pid = intval($rr['profile_id']);
            if (!isset($resultsByProfile[$pid])) $resultsByProfile[$pid] = array();
            $resultsByProfile[$pid][] = $rr;
        }
    }

    // Comment counts
    $cRows = $pdo->query("SELECT target_id, COUNT(*) as cnt FROM comments WHERE target_type = 'profile' GROUP BY target_id")->fetchAll();
    $cMap = array();
    foreach ($cRows as $cr) {
        $cMap[intval($cr['target_id'])] = intval($cr['cnt']);
    }

    foreach ($rows as &$r) {
        $pid = intval($r['id']);
        $r['social_links'] = json_decode($r['social_links'], true);
        if (!is_array($r['social_links'])) $r['social_links'] = array();
        $r['comments_count'] = isset($cMap[$pid]) ? $cMap[$pid] : 0;
        $r['quiz_results'] = isset($resultsByProfile[$pid]) ? $resultsByProfile[$pid] : array();
    }

    // Batch digital counters
    $batchRows = $pdo->query("SELECT ssc_batch, COUNT(*) as cnt FROM profiles WHERE status = 'approved' GROUP BY ssc_batch ORDER BY CAST(ssc_batch AS INTEGER) DESC")->fetchAll();

    respond(array('ok' => true, 'profiles' => $rows, 'batch_counts' => $batchRows));
}

// 3. PROFILE DETAIL
if ($action === 'profile_detail') {
    $id = isset($_GET['id']) ? intval($_GET['id']) : 0;
    $stmt = $pdo->prepare("SELECT * FROM profiles WHERE id = ?");
    $stmt->execute(array($id));
    $p = $stmt->fetch();
    if (!$p) respond(array('ok' => false, 'error' => 'প্রোফাইল পাওয়া যায়নি'), 404);

    $p['social_links'] = json_decode($p['social_links'], true);
    if (!is_array($p['social_links'])) $p['social_links'] = array();

    $cStmt = $pdo->prepare("SELECT * FROM comments WHERE target_type = 'profile' AND target_id = ? ORDER BY id DESC");
    $cStmt->execute(array($id));
    $p['comments'] = $cStmt->fetchAll();

    $qStmt = $pdo->prepare("SELECT qs.*, q.title AS quiz_title FROM quiz_submissions qs LEFT JOIN quizzes q ON q.id = qs.quiz_id WHERE qs.result_published = 1 AND qs.profile_id = ? ORDER BY qs.id DESC");
    $qStmt->execute(array($id));
    $p['quiz_results'] = $qStmt->fetchAll();

    respond(array('ok' => true, 'profile' => $p));
}

// 4. PUBLIC SUBMIT PROFILE
if ($action === 'submit_profile') {
    $b = getJsonBody();
    $name = isset($b['name']) ? trim($b['name']) : '';
    if ($name === '') respond(array('ok' => false, 'error' => 'নাম আবশ্যক'), 400);

    $social = isset($b['social_links']) ? $b['social_links'] : array();
    if (is_string($social)) $social = json_decode($social, true);
    if (!is_array($social)) $social = array();

    $stmt = $pdo->prepare("INSERT INTO profiles (name, ssc_batch, education, profession, blood_group, current_address, permanent_address, mobile, email, future_dream, photo, social_links, status)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')");
    $stmt->execute(array(
        $name,
        isset($b['ssc_batch']) ? trim($b['ssc_batch']) : '',
        isset($b['education']) ? trim($b['education']) : '',
        isset($b['profession']) ? trim($b['profession']) : '',
        isset($b['blood_group']) ? trim($b['blood_group']) : '',
        isset($b['current_address']) ? trim($b['current_address']) : '',
        isset($b['permanent_address']) ? trim($b['permanent_address']) : '',
        isset($b['mobile']) ? trim($b['mobile']) : '',
        isset($b['email']) ? trim($b['email']) : '',
        isset($b['future_dream']) ? trim($b['future_dream']) : '',
        isset($b['photo']) ? trim($b['photo']) : '',
        json_encode($social, JSON_UNESCAPED_UNICODE)
    ));
    respond(array('ok' => true, 'id' => $pdo->lastInsertId(), 'message' => 'আপনার প্রোফাইল সফলভাবে জমা হয়েছে! এডমিন অনুমোদনের পর এটি প্রকাশিত হবে।'));
}

// 5. LIKE & COMMENT
if ($action === 'like_profile') {
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $pdo->prepare("UPDATE profiles SET likes = likes + 1 WHERE id = ?")->execute(array($id));
    $likes = intval($pdo->query("SELECT likes FROM profiles WHERE id = " . $id)->fetchColumn());
    respond(array('ok' => true, 'likes' => $likes));
}

if ($action === 'comment') {
    $b = getJsonBody();
    $type = isset($b['target_type']) ? trim($b['target_type']) : '';
    $tid = isset($b['target_id']) ? intval($b['target_id']) : 0;
    $author = isset($b['author_name']) ? trim($b['author_name']) : 'অতিথি';
    $text = isset($b['comment_text']) ? trim($b['comment_text']) : '';
    if ($tid <= 0 || $text === '') respond(array('ok' => false, 'error' => 'মন্তব্য লিখুন'), 400);

    $stmt = $pdo->prepare("INSERT INTO comments (target_type, target_id, author_name, comment_text) VALUES (?, ?, ?, ?)");
    $stmt->execute(array($type, $tid, $author, $text));
    respond(array('ok' => true, 'id' => $pdo->lastInsertId()));
}

// 6. POSTS (future, news, poem)
if ($action === 'posts') {
    $isAdmin = isset($_GET['admin']) && $_GET['admin'] === '1';
    $cat = isset($_GET['category']) ? trim($_GET['category']) : '';
    if ($isAdmin) {
        requirePermission($pdo, $cat === 'poem' ? 'poems' : ($cat !== '' ? $cat : 'news'));
    }

    $where = array();
    $params = array();
    if ($cat !== '' && $cat !== 'all') {
        $where[] = "category = ?";
        $params[] = $cat;
    }
    if (!$isAdmin) {
        $where[] = "status = 'approved'";
    } else if (isset($_GET['status']) && $_GET['status'] !== '' && $_GET['status'] !== 'all') {
        $where[] = "status = ?";
        $params[] = $_GET['status'];
    }
    if (isset($_GET['tag']) && $_GET['tag'] !== '' && $_GET['tag'] !== 'all') {
        $where[] = "tag = ?";
        $params[] = $_GET['tag'];
    }
    if (isset($_GET['q']) && trim($_GET['q']) !== '') {
        $q = '%' . trim($_GET['q']) . '%';
        $where[] = "(title LIKE ? OR content LIKE ? OR author_name LIKE ?)";
        $params = array_merge($params, array($q, $q, $q));
    }

    $sql = "SELECT * FROM posts";
    if (count($where) > 0) $sql .= " WHERE " . implode(" AND ", $where);
    $sql .= " ORDER BY id DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $cRows = $pdo->query("SELECT target_id, COUNT(*) as cnt FROM comments WHERE target_type = 'post' GROUP BY target_id")->fetchAll();
    $cMap = array();
    foreach ($cRows as $cr) $cMap[intval($cr['target_id'])] = intval($cr['cnt']);

    foreach ($rows as &$r) {
        $r['comments_count'] = isset($cMap[intval($r['id'])]) ? $cMap[intval($r['id'])] : 0;
    }
    respond(array('ok' => true, 'posts' => $rows));
}

if ($action === 'post_detail') {
    $id = isset($_GET['id']) ? intval($_GET['id']) : 0;
    $pdo->prepare("UPDATE posts SET views = views + 1 WHERE id = ?")->execute(array($id));
    $stmt = $pdo->prepare("SELECT * FROM posts WHERE id = ?");
    $stmt->execute(array($id));
    $post = $stmt->fetch();
    if (!$post) respond(array('ok' => false, 'error' => 'পোস্ট পাওয়া যায়নি'), 404);

    $cStmt = $pdo->prepare("SELECT * FROM comments WHERE target_type = 'post' AND target_id = ? ORDER BY id DESC");
    $cStmt->execute(array($id));
    $post['comments'] = $cStmt->fetchAll();
    respond(array('ok' => true, 'post' => $post));
}

if ($action === 'submit_post') {
    $b = getJsonBody();
    $cat = isset($b['category']) ? trim($b['category']) : 'future';
    $title = isset($b['title']) ? trim($b['title']) : '';
    $content = isset($b['content']) ? trim($b['content']) : '';
    $author = isset($b['author_name']) ? trim($b['author_name']) : '';
    if ($title === '' || $content === '' || $author === '') {
        respond(array('ok' => false, 'error' => 'শিরোনাম, বিষয়বস্তু ও লেখকের নাম আবশ্যক'), 400);
    }
    $stmt = $pdo->prepare("INSERT INTO posts (category, title, content, author_name, author_batch, author_mobile, author_email, tag, image, pen_name, union_name, summary, publish_as, status)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')");
    $stmt->execute(array(
        $cat,
        $title,
        $content,
        $author,
        isset($b['author_batch']) ? trim($b['author_batch']) : '',
        isset($b['author_mobile']) ? trim($b['author_mobile']) : '',
        isset($b['author_email']) ? trim($b['author_email']) : '',
        isset($b['tag']) ? trim($b['tag']) : 'সাধারণ',
        isset($b['image']) ? trim($b['image']) : '',
        isset($b['pen_name']) ? trim($b['pen_name']) : '',
        isset($b['union_name']) ? trim($b['union_name']) : '',
        isset($b['summary']) ? trim($b['summary']) : '',
        isset($b['publish_as']) ? trim($b['publish_as']) : 'own'
    ));
    respond(array('ok' => true, 'id' => $pdo->lastInsertId(), 'message' => 'আপনার লেখাটি সফলভাবে জমা হয়েছে! এডমিন অনুমোদনের পর প্রকাশিত হবে।'));
}

if ($action === 'like_post') {
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $pdo->prepare("UPDATE posts SET likes = likes + 1 WHERE id = ?")->execute(array($id));
    $likes = intval($pdo->query("SELECT likes FROM posts WHERE id = " . $id)->fetchColumn());
    respond(array('ok' => true, 'likes' => $likes));
}

// 7. QUIZZES & SUBMISSIONS
if ($action === 'quizzes') {
    $isAdmin = isset($_GET['admin']) && $_GET['admin'] === '1';
    if ($isAdmin) requirePermission($pdo, 'quizzes');

    $sql = $isAdmin ? "SELECT * FROM quizzes ORDER BY id DESC" : "SELECT * FROM quizzes WHERE status = 'active' ORDER BY id DESC";
    $rows = $pdo->query($sql)->fetchAll();
    foreach ($rows as &$r) {
        $qs = json_decode($r['questions_json'], true);
        $r['questions'] = is_array($qs) ? $qs : array();
    }

    $pubResults = $pdo->query("SELECT qs.*, q.title AS quiz_title FROM quiz_submissions qs LEFT JOIN quizzes q ON q.id = qs.quiz_id WHERE qs.result_published = 1 ORDER BY qs.id DESC LIMIT 20")->fetchAll();

    respond(array('ok' => true, 'quizzes' => $rows, 'published_results' => $pubResults));
}

if ($action === 'submit_quiz') {
    $b = getJsonBody();
    $quizId = isset($b['quiz_id']) ? intval($b['quiz_id']) : 0;
    $name = isset($b['participant_name']) ? trim($b['participant_name']) : '';
    $batch = isset($b['ssc_batch']) ? trim($b['ssc_batch']) : '';
    $mobile = isset($b['mobile']) ? trim($b['mobile']) : '';
    $answers = isset($b['answers']) ? $b['answers'] : array();
    if ($quizId <= 0 || $name === '') respond(array('ok' => false, 'error' => 'অংশগ্রহণকারীর নাম ও কুইজ আবশ্যক'), 400);

    // Match profile if exists
    $profileId = null;
    if ($batch !== '') {
        $pStmt = $pdo->prepare("SELECT id FROM profiles WHERE name LIKE ? AND ssc_batch = ? LIMIT 1");
        $pStmt->execute(array('%' . $name . '%', $batch));
        $found = $pStmt->fetchColumn();
        if ($found) $profileId = intval($found);
    }

    // Auto calculate MCQ score if possible
    $qRow = $pdo->prepare("SELECT questions_json FROM quizzes WHERE id = ?");
    $qRow->execute(array($quizId));
    $qJson = $qRow->fetchColumn();
    $qs = json_decode($qJson, true);
    $autoScore = '';
    if (is_array($qs) && count($qs) > 0 && is_array($answers)) {
        $correct = 0;
        $total = count($qs);
        foreach ($qs as $idx => $qItem) {
            if (isset($qItem['ans']) && isset($answers[$idx]) && intval($answers[$idx]) === intval($qItem['ans'])) {
                $correct++;
            }
        }
        $autoScore = $correct . '/' . $total;
    }

    $stmt = $pdo->prepare("INSERT INTO quiz_submissions (quiz_id, profile_id, participant_name, ssc_batch, mobile, answers_json, score)
                           VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute(array($quizId, $profileId, $name, $batch, $mobile, json_encode($answers, JSON_UNESCAPED_UNICODE), $autoScore));
    respond(array('ok' => true, 'id' => $pdo->lastInsertId(), 'auto_score' => $autoScore, 'message' => 'আপনার উত্তর সফলভাবে জমা হয়েছে!'));
}

// 8. ADMINISTRATION & CONTACT
if ($action === 'administration') {
    $rows = $pdo->query("SELECT * FROM administration ORDER BY sort_order ASC, id ASC")->fetchAll();
    foreach ($rows as &$r) {
        $sl = json_decode($r['social_links'], true);
        $r['social_links'] = is_array($sl) ? $sl : array();
    }
    respond(array('ok' => true, 'members' => $rows));
}

// 9. REPORTS / CONTACT MESSAGES
if ($action === 'submit_report') {
    $b = getJsonBody();
    $name = isset($b['reporter_name']) ? trim($b['reporter_name']) : '';
    $contact = isset($b['reporter_contact']) ? trim($b['reporter_contact']) : '';
    $subject = isset($b['subject']) ? trim($b['subject']) : 'সাধারণ বার্তা';
    $message = isset($b['message']) ? trim($b['message']) : '';
    if ($name === '' || $message === '') respond(array('ok' => false, 'error' => 'নাম ও বার্তা আবশ্যক'), 400);

    $stmt = $pdo->prepare("INSERT INTO reports (reporter_name, reporter_contact, subject, message) VALUES (?, ?, ?, ?)");
    $stmt->execute(array($name, $contact, $subject, $message));
    respond(array('ok' => true, 'message' => 'আপনার বার্তা/রিপোর্ট সফলভাবে পাঠানো হয়েছে।'));
}


// 9B. NEWSLETTER SUBSCRIBE
if ($action === 'subscribe') {
    $b = getJsonBody();
    $email = isset($b['email']) ? trim($b['email']) : '';
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(array('ok' => false, 'error' => 'সঠিক ইমেইল ঠিকানা দিন'), 400);
    }
    $stmt = $pdo->prepare("INSERT OR IGNORE INTO subscribers (email) VALUES (?)");
    $stmt->execute(array($email));
    respond(array('ok' => true, 'message' => 'ধন্যবাদ! আপনি সফলভাবে সাবস্ক্রাইব করেছেন।'));
}

// 10. IMAGE UPLOAD (Unified uploads/ folder + DB & file log)
if ($action === 'upload_image') {
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        respond(array('ok' => false, 'error' => 'ফাইল আপলোড ব্যর্থ হয়েছে'), 400);
    }
    $folder = isset($_POST['folder']) ? preg_replace('/[^a-z0-9_-]/i', '', $_POST['folder']) : 'general';

    $ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, array('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'))) {
        respond(array('ok' => false, 'error' => 'শুধুমাত্র ছবি ফাইল (JPG, PNG, WEBP, GIF, SVG) আপলোড করা যাবে'), 400);
    }

    $targetDir = $baseDir . '/uploads';
    if (!is_dir($targetDir)) @mkdir($targetDir, 0755, true);

    $newName = $folder . '_' . time() . '_' . mt_rand(1000, 9999) . '.' . $ext;
    $destPath = $targetDir . '/' . $newName;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $destPath)) {
        respond(array('ok' => false, 'error' => 'ফাইল সংরক্ষণ করা যায়নি'), 500);
    }

    $relUrl = 'uploads/' . $newName;
    $pdo->prepare("INSERT INTO uploaded_files (original_name, saved_path, folder_tag) VALUES (?, ?, ?)")
        ->execute(array($_FILES['file']['name'], $relUrl, $folder));
    @file_put_contents($targetDir . '/uploads_log.txt', date('Y-m-d H:i:s') . " | " . $folder . " | " . $relUrl . "\n", FILE_APPEND);

    respond(array('ok' => true, 'url' => $relUrl));
}

// ==========================================
// ADMIN AUTHENTICATION & TIME LOCK
// ==========================================
if ($action === 'admin_login') {
    $b = getJsonBody();
    $email = isset($b['email']) ? trim($b['email']) : '';
    $password = isset($b['password']) ? $b['password'] : '';
    $device = isset($b['device_type']) ? trim($b['device_type']) : 'desktop';

    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? AND status = 'active' LIMIT 1");
    $stmt->execute(array($email));
    $user = $stmt->fetch();

    if (!$user || !verifyPassword($password, $user['password_hash'])) {
        respond(array('ok' => false, 'error' => 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়'), 401);
    }

    $token = bin2hex(openssl_random_pseudo_bytes(24));
    $ttl = ($device === 'mobile') ? (86400 * 30) : (86400);
    $expiresAt = time() + $ttl;

    $pdo->prepare("INSERT INTO sessions (token, user_id, device_type, unlocked, expires_at) VALUES (?, ?, ?, 0, ?)")
        ->execute(array($token, $user['id'], $device, $expiresAt));
    $cookieExpire = ($device === 'mobile') ? (time() + 86400 * 30) : 0;
    @setcookie('mk_admin_token', $token, $cookieExpire, '/', '', false, true);

    // Track login log
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr($_SERVER['HTTP_USER_AGENT'], 0, 200) : '';
    $pdo->prepare("INSERT INTO login_logs (user_id, user_name, user_email, role, device_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
        ->execute(array($user['id'], $user['name'], $user['email'], $user['role'], $device, $ip, $ua));

    $perms = json_decode($user['permissions'], true);
    respond(array(
        'ok' => true,
        'token' => $token,
        'requires_timelock' => true,
        'user' => array(
            'id' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'photo' => $user['photo'],
            'designation' => $user['designation'],
            'role' => $user['role'],
            'permissions' => is_array($perms) ? $perms : array()
        )
    ));
}

if ($action === 'verify_timelock') {
    $user = getCurrentUser($pdo, false);
    if (!$user) respond(array('ok' => false, 'error' => 'আগে লগইন করুন'), 401);

    $b = getJsonBody();
    $pin = isset($b['pin']) ? trim($b['pin']) : '';
    $expectedPin = $pdo->query("SELECT setting_value FROM site_settings WHERE setting_key = 'time_lock_pin'")->fetchColumn();
    if ($expectedPin === false || $expectedPin === '') $expectedPin = '1971';

    if ($pin !== $expectedPin) {
        respond(array('ok' => false, 'error' => 'টাইম লক পিন সঠিক নয়!'), 403);
    }

    $pdo->prepare("UPDATE sessions SET unlocked = 1 WHERE token = ?")->execute(array($user['token']));
    respond(array('ok' => true, 'unlocked' => true));
}

if ($action === 'admin_check') {
    $user = getCurrentUser($pdo, false);
    if (!$user) respond(array('ok' => false, 'authenticated' => false), 200);
    respond(array(
        'ok' => true,
        'authenticated' => true,
        'unlocked' => intval($user['unlocked']) === 1,
        'user' => array(
            'id' => $user['user_id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'photo' => $user['photo'],
            'designation' => $user['designation'],
            'role' => $user['role'],
            'permissions' => $user['permissions_list']
        )
    ));
}

if ($action === 'admin_logout') {
    $token = getAuthToken();
    if ($token !== '') {
        $pdo->prepare("DELETE FROM sessions WHERE token = ?")->execute(array($token));
    }
    @setcookie('mk_admin_token', '', time() - 3600, '/', '', false, true);
    respond(array('ok' => true));
}

// ==========================================
// ADMIN DASHBOARD & CRUD
// ==========================================
if ($action === 'admin_dashboard') {
    $user = requirePermission($pdo, '');
    $stats = array(
        'profiles_approved' => intval($pdo->query("SELECT COUNT(*) FROM profiles WHERE status = 'approved'")->fetchColumn()),
        'profiles_pending'  => intval($pdo->query("SELECT COUNT(*) FROM profiles WHERE status = 'pending'")->fetchColumn()),
        'future_total'      => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'future'")->fetchColumn()),
        'future_pending'    => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'future' AND status = 'pending'")->fetchColumn()),
        'news_total'        => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'news'")->fetchColumn()),
        'news_pending'      => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'news' AND status = 'pending'")->fetchColumn()),
        'poems_total'       => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'poem'")->fetchColumn()),
        'poems_pending'     => intval($pdo->query("SELECT COUNT(*) FROM posts WHERE category = 'poem' AND status = 'pending'")->fetchColumn()),
        'quizzes_total'     => intval($pdo->query("SELECT COUNT(*) FROM quizzes")->fetchColumn()),
        'submissions_total' => intval($pdo->query("SELECT COUNT(*) FROM quiz_submissions")->fetchColumn()),
        'admins_total'      => intval($pdo->query("SELECT COUNT(*) FROM administration")->fetchColumn()),
        'users_total'       => intval($pdo->query("SELECT COUNT(*) FROM users")->fetchColumn()),
        'notices_total'     => intval($pdo->query("SELECT COUNT(*) FROM notices")->fetchColumn()),
        'reports_pending'   => intval($pdo->query("SELECT COUNT(*) FROM reports WHERE status = 'pending'")->fetchColumn()),
        'subscribers_total' => intval($pdo->query("SELECT COUNT(*) FROM subscribers")->fetchColumn()),
        'comments_total'    => intval($pdo->query("SELECT COUNT(*) FROM comments")->fetchColumn())
    );
    $logs = $pdo->query("SELECT * FROM login_logs ORDER BY id DESC LIMIT 15")->fetchAll();
    respond(array('ok' => true, 'stats' => $stats, 'login_logs' => $logs));
}

// Admin Save/Edit Profile
if ($action === 'admin_save_profile') {
    requirePermission($pdo, 'profiles');
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $social = isset($b['social_links']) ? $b['social_links'] : array();
    if (is_string($social)) $social = json_decode($social, true);
    if (!is_array($social)) $social = array();
    $socialJson = json_encode($social, JSON_UNESCAPED_UNICODE);

    if ($id > 0) {
        $stmt = $pdo->prepare("UPDATE profiles SET name=?, ssc_batch=?, education=?, profession=?, blood_group=?, current_address=?, permanent_address=?, mobile=?, email=?, future_dream=?, photo=?, social_links=?, status=? WHERE id=?");
        $stmt->execute(array(
            trim($b['name']), trim($b['ssc_batch']), trim($b['education']), trim($b['profession']),
            trim($b['blood_group']), trim($b['current_address']), trim($b['permanent_address']),
            trim($b['mobile']), trim($b['email']), trim($b['future_dream']), trim($b['photo']),
            $socialJson, isset($b['status']) ? $b['status'] : 'approved', $id
        ));
    } else {
        $stmt = $pdo->prepare("INSERT INTO profiles (name, ssc_batch, education, profession, blood_group, current_address, permanent_address, mobile, email, future_dream, photo, social_links, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $stmt->execute(array(
            trim($b['name']), trim($b['ssc_batch']), trim($b['education']), trim($b['profession']),
            trim($b['blood_group']), trim($b['current_address']), trim($b['permanent_address']),
            trim($b['mobile']), trim($b['email']), trim($b['future_dream']), trim($b['photo']),
            $socialJson, isset($b['status']) ? $b['status'] : 'approved'
        ));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_set_profile_status') {
    requirePermission($pdo, 'profiles');
    $b = getJsonBody();
    $pdo->prepare("UPDATE profiles SET status = ? WHERE id = ?")->execute(array($b['status'], intval($b['id'])));
    respond(array('ok' => true));
}

if ($action === 'admin_delete_profile') {
    requirePermission($pdo, 'profiles');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM profiles WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}

// Admin Posts CRUD
if ($action === 'admin_save_post') {
    $b = getJsonBody();
    $cat = isset($b['category']) ? trim($b['category']) : 'future';
    requirePermission($pdo, $cat === 'poem' ? 'poems' : $cat);
    $id = isset($b['id']) ? intval($b['id']) : 0;

    if ($id > 0) {
        $stmt = $pdo->prepare("UPDATE posts SET category=?, title=?, content=?, author_name=?, author_batch=?, tag=?, image=?, status=? WHERE id=?");
        $stmt->execute(array(
            $cat, trim($b['title']), trim($b['content']), trim($b['author_name']),
            isset($b['author_batch']) ? trim($b['author_batch']) : '',
            isset($b['tag']) ? trim($b['tag']) : '',
            isset($b['image']) ? trim($b['image']) : '',
            isset($b['status']) ? $b['status'] : 'approved', $id
        ));
    } else {
        $stmt = $pdo->prepare("INSERT INTO posts (category, title, content, author_name, author_batch, tag, image, status) VALUES (?,?,?,?,?,?,?,?)");
        $stmt->execute(array(
            $cat, trim($b['title']), trim($b['content']), trim($b['author_name']),
            isset($b['author_batch']) ? trim($b['author_batch']) : '',
            isset($b['tag']) ? trim($b['tag']) : '',
            isset($b['image']) ? trim($b['image']) : '',
            isset($b['status']) ? $b['status'] : 'approved'
        ));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_set_post_status') {
    requirePermission($pdo, 'news');
    $b = getJsonBody();
    $pdo->prepare("UPDATE posts SET status = ? WHERE id = ?")->execute(array($b['status'], intval($b['id'])));
    respond(array('ok' => true));
}

if ($action === 'admin_delete_post') {
    requirePermission($pdo, 'news');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM posts WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}

// Admin Quizzes & Submissions
if ($action === 'admin_save_quiz') {
    requirePermission($pdo, 'quizzes');
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $qs = isset($b['questions']) ? $b['questions'] : array();
    $qJson = is_string($qs) ? $qs : json_encode($qs, JSON_UNESCAPED_UNICODE);

    if ($id > 0) {
        $pdo->prepare("UPDATE quizzes SET title=?, category=?, description=?, questions_json=?, deadline=?, status=? WHERE id=?")
            ->execute(array(trim($b['title']), trim($b['category']), trim($b['description']), $qJson, trim($b['deadline']), trim($b['status']), $id));
    } else {
        $pdo->prepare("INSERT INTO quizzes (title, category, description, questions_json, deadline, status) VALUES (?,?,?,?,?,?)")
            ->execute(array(trim($b['title']), trim($b['category']), trim($b['description']), $qJson, trim($b['deadline']), isset($b['status']) ? $b['status'] : 'active'));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_delete_quiz') {
    requirePermission($pdo, 'quizzes');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM quizzes WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}

if ($action === 'admin_quiz_submissions') {
    requirePermission($pdo, 'quizzes');
    $rows = $pdo->query("SELECT qs.*, q.title AS quiz_title, p.name AS linked_profile_name FROM quiz_submissions qs LEFT JOIN quizzes q ON q.id = qs.quiz_id LEFT JOIN profiles p ON p.id = qs.profile_id ORDER BY qs.id DESC")->fetchAll();
    $profiles = $pdo->query("SELECT id, name, ssc_batch FROM profiles WHERE status = 'approved' ORDER BY name ASC")->fetchAll();
    respond(array('ok' => true, 'submissions' => $rows, 'profiles' => $profiles));
}

if ($action === 'admin_publish_result') {
    requirePermission($pdo, 'quizzes');
    $b = getJsonBody();
    $pid = isset($b['profile_id']) && intval($b['profile_id']) > 0 ? intval($b['profile_id']) : null;
    $pdo->prepare("UPDATE quiz_submissions SET profile_id=?, score=?, rank_title=?, remarks=?, result_published=1 WHERE id=?")
        ->execute(array($pid, trim($b['score']), trim($b['rank_title']), trim($b['remarks']), intval($b['id'])));
    respond(array('ok' => true));
}

// Admin Administration Team
if ($action === 'admin_save_admin_member') {
    requirePermission($pdo, 'administration');
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $social = isset($b['social_links']) ? $b['social_links'] : array();
    $sJson = is_string($social) ? $social : json_encode($social, JSON_UNESCAPED_UNICODE);

    if ($id > 0) {
        $pdo->prepare("UPDATE administration SET name=?, role_title=?, department=?, bio=?, mobile=?, email=?, photo=?, social_links=?, sort_order=? WHERE id=?")
            ->execute(array(trim($b['name']), trim($b['role_title']), trim($b['department']), trim($b['bio']), trim($b['mobile']), trim($b['email']), trim($b['photo']), $sJson, intval($b['sort_order']), $id));
    } else {
        $pdo->prepare("INSERT INTO administration (name, role_title, department, bio, mobile, email, photo, social_links, sort_order) VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute(array(trim($b['name']), trim($b['role_title']), trim($b['department']), trim($b['bio']), trim($b['mobile']), trim($b['email']), trim($b['photo']), $sJson, intval($b['sort_order'])));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_delete_admin_member') {
    requirePermission($pdo, 'administration');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM administration WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}

// Admin Users & RBAC
if ($action === 'admin_users') {
    requirePermission($pdo, 'users');
    $rows = $pdo->query("SELECT id, name, email, photo, designation, role, permissions, status, created_at FROM users ORDER BY id DESC")->fetchAll();
    foreach ($rows as &$r) {
        $r['permissions'] = json_decode($r['permissions'], true);
    }
    respond(array('ok' => true, 'users' => $rows));
}

if ($action === 'admin_save_user') {
    requirePermission($pdo, 'users');
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    $perms = isset($b['permissions']) ? $b['permissions'] : array();
    $pJson = is_string($perms) ? $perms : json_encode($perms, JSON_UNESCAPED_UNICODE);

    if ($id > 0) {
        if (isset($b['password']) && trim($b['password']) !== '') {
            $hash = 'sha256$mk_1971_salt$' . hash('sha256', 'mk_1971_salt' . trim($b['password']));
            $pdo->prepare("UPDATE users SET name=?, email=?, password_hash=?, photo=?, designation=?, role=?, permissions=?, status=? WHERE id=?")
                ->execute(array(trim($b['name']), trim($b['email']), $hash, trim($b['photo']), trim($b['designation']), trim($b['role']), $pJson, trim($b['status']), $id));
        } else {
            $pdo->prepare("UPDATE users SET name=?, email=?, photo=?, designation=?, role=?, permissions=?, status=? WHERE id=?")
                ->execute(array(trim($b['name']), trim($b['email']), trim($b['photo']), trim($b['designation']), trim($b['role']), $pJson, trim($b['status']), $id));
        }
    } else {
        $pw = isset($b['password']) && trim($b['password']) !== '' ? trim($b['password']) : 'User@1971';
        $hash = 'sha256$mk_1971_salt$' . hash('sha256', 'mk_1971_salt' . $pw);
        $pdo->prepare("INSERT INTO users (name, email, password_hash, photo, designation, role, permissions, status) VALUES (?,?,?,?,?,?,?,?)")
            ->execute(array(trim($b['name']), trim($b['email']), $hash, trim($b['photo']), trim($b['designation']), trim($b['role']), $pJson, 'active'));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_delete_user') {
    $me = requirePermission($pdo, 'users');
    $b = getJsonBody();
    $id = intval($b['id']);
    if ($id === intval($me['user_id'])) respond(array('ok' => false, 'error' => 'নিজের একাউন্ট ডিলিট করা যাবে না'), 400);
    $pdo->prepare("DELETE FROM users WHERE id = ?")->execute(array($id));
    respond(array('ok' => true));
}

// Admin Notices
if ($action === 'admin_notices') {
    requirePermission($pdo, 'notices');
    $rows = $pdo->query("SELECT * FROM notices ORDER BY id DESC")->fetchAll();
    respond(array('ok' => true, 'notices' => $rows));
}

if ($action === 'admin_save_notice') {
    requirePermission($pdo, 'notices');
    $b = getJsonBody();
    $id = isset($b['id']) ? intval($b['id']) : 0;
    if ($id > 0) {
        $pdo->prepare("UPDATE notices SET title=?, body=?, priority=?, is_active=? WHERE id=?")
            ->execute(array(trim($b['title']), trim($b['body']), trim($b['priority']), intval($b['is_active']), $id));
    } else {
        $pdo->prepare("INSERT INTO notices (title, body, priority, is_active) VALUES (?,?,?,?)")
            ->execute(array(trim($b['title']), trim($b['body']), isset($b['priority']) ? $b['priority'] : 'normal', isset($b['is_active']) ? intval($b['is_active']) : 1));
    }
    respond(array('ok' => true));
}

if ($action === 'admin_delete_notice') {
    requirePermission($pdo, 'notices');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM notices WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}

// Admin Site Settings
if ($action === 'admin_get_settings') {
    requirePermission($pdo, 'settings');
    $rows = $pdo->query("SELECT setting_key, setting_value FROM site_settings")->fetchAll();
    $out = array();
    foreach ($rows as $r) $out[$r['setting_key']] = $r['setting_value'];
    respond(array('ok' => true, 'settings' => $out));
}

if ($action === 'admin_save_settings') {
    requirePermission($pdo, 'settings');
    $b = getJsonBody();
    $stmt = $pdo->prepare("INSERT OR REPLACE INTO site_settings (setting_key, setting_value) VALUES (?, ?)");
    foreach ($b as $k => $v) {
        if ($k === 'action' || $k === 'token') continue;
        $stmt->execute(array($k, is_string($v) ? trim($v) : json_encode($v)));
    }
    respond(array('ok' => true));
}


// Admin Subscribers
if ($action === 'admin_subscribers') {
    requirePermission($pdo, 'reports');
    $rows = $pdo->query("SELECT * FROM subscribers ORDER BY id DESC")->fetchAll();
    respond(array('ok' => true, 'subscribers' => $rows));
}
if ($action === 'admin_delete_subscriber') {
    requirePermission($pdo, 'reports');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM subscribers WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}


// Admin Comments Moderation
if ($action === 'admin_comments') {
    requirePermission($pdo, 'news');
    $rows = $pdo->query("SELECT * FROM comments ORDER BY id DESC LIMIT 200")->fetchAll();
    respond(array('ok' => true, 'comments' => $rows));
}
if ($action === 'admin_delete_comment') {
    requirePermission($pdo, 'news');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM comments WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}
if ($action === 'admin_delete_report') {
    requirePermission($pdo, 'reports');
    $b = getJsonBody();
    $pdo->prepare("DELETE FROM reports WHERE id = ?")->execute(array(intval($b['id'])));
    respond(array('ok' => true));
}


// Admin Uploaded Media Gallery
if ($action === 'admin_media') {
    requirePermission($pdo, '');
    $rows = $pdo->query("SELECT * FROM uploaded_files ORDER BY id DESC LIMIT 100")->fetchAll();
    respond(array('ok' => true, 'files' => $rows));
}
if ($action === 'admin_delete_media') {
    requirePermission($pdo, 'settings');
    $b = getJsonBody();
    $id = intval($b['id']);
    $path = $pdo->prepare("SELECT saved_path FROM uploaded_files WHERE id = ?");
    $path->execute(array($id));
    $p = $path->fetchColumn();
    if ($p && strpos($p, 'uploads/') === 0 && file_exists($baseDir . '/' . $p)) {
        @unlink($baseDir . '/' . $p);
    }
    $pdo->prepare("DELETE FROM uploaded_files WHERE id = ?")->execute(array($id));
    respond(array('ok' => true));
}

// Admin Reports
if ($action === 'admin_reports') {
    requirePermission($pdo, 'reports');
    $rows = $pdo->query("SELECT * FROM reports ORDER BY id DESC")->fetchAll();
    respond(array('ok' => true, 'reports' => $rows));
}

if ($action === 'admin_update_report') {
    requirePermission($pdo, 'reports');
    $b = getJsonBody();
    $pdo->prepare("UPDATE reports SET status = ? WHERE id = ?")->execute(array($b['status'], intval($b['id'])));
    respond(array('ok' => true));
}

respond(array('ok' => false, 'error' => 'অজানা অ্যাকশন'), 404);
