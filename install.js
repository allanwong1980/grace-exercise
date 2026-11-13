const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function install(){
    const pool = mysql.createPool({
        host:'localhost',user:'gracewong',password:'Grace@19751113',
        database:'grace_exercise',charset:'utf8mb4'
    });
    const tables = [
    `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL, display_name VARCHAR(100) NOT NULL,
        role ENUM('student','admin') DEFAULT 'student', class_name VARCHAR(50) DEFAULT 'S6A',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS submissions (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, question_num INT NOT NULL,
        answer TEXT, answer2 TEXT, step1_answer VARCHAR(20) DEFAULT '', step2_answer VARCHAR(20) DEFAULT '',
        is_correct TINYINT DEFAULT 0, score INT DEFAULT 0, submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_q (user_id,question_num),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS exercise_status (
        user_id INT PRIMARY KEY, is_submitted TINYINT DEFAULT 0, total_score INT DEFAULT 0,
        submitted_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY, sender_id INT NOT NULL, receiver_id INT NOT NULL,
        subject VARCHAR(200) DEFAULT '', body TEXT NOT NULL, is_read TINYINT DEFAULT 0,
        parent_id INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ];
    for(const sql of tables) await pool.execute(sql);
    const [adm]=await pool.execute("SELECT COUNT(*) as c FROM users WHERE username='teacher'");
    if(!adm[0].c){
        const h=await bcrypt.hash('Admin@123',10);
        await pool.execute("INSERT INTO users (username,password,display_name,role) VALUES (?,?,?,?)",['teacher',h,'Teacher Admin','admin']);
    }
    console.log('✅ Database tables ready. Admin: teacher / Admin@123');
    process.exit(0);
}
install().catch(e=>{console.error(e);process.exit(1);});
