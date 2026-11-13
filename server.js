const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const { getQuestions, gradeAnswer } = require('./questions');

const app = express();
const PORT = process.env.PORT || 3001;

const pool = mysql.createPool({
    host:'localhost', user:'gracewong', password:'Grace@19751113',
    database:'grace_exercise', charset:'utf8mb4',
    waitForConnections:true, connectionLimit:10
});

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
    secret:'grace-pronoun-practice-2024-secret',
    resave:false, saveUninitialized:false,
    cookie:{maxAge:24*60*60*1000}
}));

function isLoggedIn(r){return !!r.session.userId;}
function isAdm(r){return r.session.role==='admin';}
function reqLogin(req,res,next){if(!isLoggedIn(req))return res.redirect('/login.html');next();}
function reqAdmin(req,res,next){if(!isLoggedIn(req))return res.redirect('/login.html');if(!isAdm(req))return res.redirect('/dashboard.html');next();}
function reqLoginAPI(req,res,next){if(!isLoggedIn(req))return res.json({ok:false,error:'Not logged in'});next();}

// Protected pages
app.get('/exercise.html', reqLogin, (req,res)=>{
    if(isAdm(req)) return res.redirect('/admin.html');
    res.sendFile(path.join(__dirname,'public','exercise.html'));
});
app.get('/dashboard.html', reqLogin, (req,res)=>{
    if(isAdm(req)) return res.redirect('/admin.html');
    res.sendFile(path.join(__dirname,'public','dashboard.html'));
});
app.get('/admin.html', reqAdmin, (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/messages.html', reqLogin, (req,res)=>res.sendFile(path.join(__dirname,'public','messages.html')));
app.get('/manual.html', reqAdmin, (req,res)=>res.sendFile(path.join(__dirname,'public','manual.html')));

app.get('/', (req,res)=>{
    if(isLoggedIn(req)) res.redirect(isAdm(req)?'/admin.html':'/dashboard.html');
    else res.redirect('/login.html');
});

// Static files (login.html, register.html, style.css etc.)
app.use(express.static(path.join(__dirname,'public')));

// ====== API ======

app.get('/api/me', (req,res)=>{
    if(!isLoggedIn(req)) return res.json({loggedIn:false});
    res.json({loggedIn:true, userId:req.session.userId, username:req.session.username,
              displayName:req.session.displayName, role:req.session.role});
});

app.post('/api/login', async(req,res)=>{
    try{
        const {username,password}=req.body;
        const [rows]=await pool.execute('SELECT * FROM users WHERE username=?',[username]);
        if(!rows.length) return res.json({ok:false,error:'Invalid username or password.'});
        const user=rows[0];
        // PHP bcrypt compat: $2y$ -> $2a$
        let hash=user.password;
        if(hash.startsWith('$2y$')) hash='$2a$'+hash.slice(4);
        const match=await bcrypt.compare(password,hash);
        if(!match) return res.json({ok:false,error:'Invalid username or password.'});
        req.session.userId=user.id; req.session.role=user.role;
        req.session.displayName=user.display_name; req.session.username=user.username;
        res.json({ok:true, redirect: user.role==='admin'?'/admin.html':'/dashboard.html'});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/register', async(req,res)=>{
    try{
        const {username,display_name,password,password2,class_name}=req.body;
        if(!username||username.length<3||username.length>30) return res.json({ok:false,error:'Username must be 3–30 characters.'});
        if(!/^[a-zA-Z0-9_]+$/.test(username)) return res.json({ok:false,error:'Username: letters, numbers, underscores only.'});
        if(!display_name||display_name.length<2) return res.json({ok:false,error:'Display name must be at least 2 characters.'});
        if(!password||password.length<6) return res.json({ok:false,error:'Password must be at least 6 characters.'});
        if(password!==password2) return res.json({ok:false,error:'Passwords do not match.'});
        const [ex]=await pool.execute('SELECT COUNT(*) as c FROM users WHERE username=?',[username]);
        if(ex[0].c>0) return res.json({ok:false,error:'Username already taken.'});
        const hashed=await bcrypt.hash(password,10);
        await pool.execute('INSERT INTO users (username,password,display_name,role,class_name) VALUES (?,?,?,?,?)',
            [username,hashed,display_name,'student',class_name||'S6A']);
        res.json({ok:true});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/logout', (req,res)=>{req.session.destroy();res.json({ok:true});});

app.get('/api/exercise-data', reqLoginAPI, async(req,res)=>{
    try{
        const uid=req.session.userId; const questions=getQuestions();
        const [st]=await pool.execute('SELECT is_submitted FROM exercise_status WHERE user_id=?',[uid]);
        const isSubmitted=st.length?st[0].is_submitted:0;
        const [saved]=await pool.execute('SELECT question_num,answer,answer2,step1_answer,step2_answer FROM submissions WHERE user_id=?',[uid]);
        const savedMap={}; saved.forEach(r=>{savedMap[r.question_num]=r;});
        const cq={};
        for(const [qn,q] of Object.entries(questions)){
            cq[qn]={type:q.type,pronoun:q.pronoun,passage:q.passage,question:q.question,
                     verify_sentence:q.verify_sentence||null,pn:q.pn||null,pc:q.pc||null};
        }
        res.json({ok:true,questions:cq,saved:savedMap,isSubmitted,totalQ:Object.keys(questions).length});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/save-answer', reqLoginAPI, async(req,res)=>{
    try{
        if(isAdm(req)) return res.json({ok:false,error:'Admin cannot submit'});
        const uid=req.session.userId;
        const [st]=await pool.execute('SELECT is_submitted FROM exercise_status WHERE user_id=?',[uid]);
        if(st.length&&st[0].is_submitted) return res.json({ok:false,error:'Already submitted'});
        const {qnum,answer,answer2,step1,step2}=req.body;
        const qn=parseInt(qnum); if(qn<1||qn>25) return res.json({ok:false,error:'Invalid question'});
        await pool.execute(
            `INSERT INTO submissions (user_id,question_num,answer,answer2,step1_answer,step2_answer) VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE answer=VALUES(answer),answer2=VALUES(answer2),step1_answer=VALUES(step1_answer),step2_answer=VALUES(step2_answer),submitted_at=NOW()`,
            [uid,qn,answer||'',answer2||'',step1||'',step2||'']);
        res.json({ok:true});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/submit-exercise', reqLoginAPI, async(req,res)=>{
    try{
        if(isAdm(req)) return res.json({ok:false,error:'Admin cannot submit'});
        const uid=req.session.userId;
        const [st]=await pool.execute('SELECT is_submitted FROM exercise_status WHERE user_id=?',[uid]);
        if(st.length&&st[0].is_submitted) return res.json({ok:false,error:'Already submitted'});
        const questions=getQuestions(); let totalScore=0;
        for(const [qnStr,q] of Object.entries(questions)){
            const qn=parseInt(qnStr);
            const [sub]=await pool.execute('SELECT answer,answer2 FROM submissions WHERE user_id=? AND question_num=?',[uid,qn]);
            const ans=sub.length?sub[0].answer:''; const ans2=sub.length?sub[0].answer2:'';
            const score=gradeAnswer(qn,ans,ans2); totalScore+=score;
            if(sub.length) await pool.execute('UPDATE submissions SET is_correct=?,score=? WHERE user_id=? AND question_num=?',[score,score,uid,qn]);
            else await pool.execute('INSERT INTO submissions (user_id,question_num,answer,answer2,is_correct,score) VALUES (?,?,?,?,0,0)',[uid,qn,'','']);
        }
        await pool.execute(
            `INSERT INTO exercise_status (user_id,is_submitted,total_score,submitted_at) VALUES (?,1,?,NOW())
             ON DUPLICATE KEY UPDATE is_submitted=1,total_score=VALUES(total_score),submitted_at=NOW()`,[uid,totalScore]);
        res.json({ok:true,score:totalScore,total:Object.keys(questions).length});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.get('/api/dashboard-data', reqLoginAPI, async(req,res)=>{
    try{
        const uid=req.session.userId; const questions=getQuestions(); const totalQ=Object.keys(questions).length;
        const [st]=await pool.execute('SELECT * FROM exercise_status WHERE user_id=?',[uid]);
        const status=st.length?st[0]:null;
        const isSubmitted=status?status.is_submitted:0; const myScore=status?status.total_score:0;
        let myAnswers={};
        if(isSubmitted){
            const [sub]=await pool.execute('SELECT * FROM submissions WHERE user_id=? ORDER BY question_num',[uid]);
            sub.forEach(r=>{myAnswers[r.question_num]=r;});
        }
        const [cs]=await pool.execute(`SELECT u.id,u.display_name,es.total_score,es.submitted_at FROM exercise_status es JOIN users u ON u.id=es.user_id WHERE es.is_submitted=1 AND u.role='student' ORDER BY es.total_score DESC,es.submitted_at ASC`);
        const classAvg=cs.length?Math.round(cs.reduce((s,r)=>s+r.total_score,0)/cs.length*10)/10:0;
        let myRank=0; cs.forEach((s,i)=>{if(s.id===uid)myRank=i+1;});
        const qi={};
        for(const [qn,q] of Object.entries(questions)){
            qi[qn]={pronoun:q.pronoun,type:q.type,answer:q.type==='former_latter'?null:q.answer,
                     answer_former:q.answer_former||null,answer_latter:q.answer_latter||null};
        }
        res.json({ok:true,isSubmitted,myScore,totalQ,myAnswers,classStats:cs,classAvg,myRank,questionInfo:qi,
                  submittedAt:status?status.submitted_at:null});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.get('/api/admin-data', reqLoginAPI, async(req,res)=>{
    if(!isAdm(req)) return res.json({ok:false,error:'Not admin'});
    try{
        const questions=getQuestions(); const totalQ=Object.keys(questions).length;
        const [students]=await pool.execute(`SELECT u.*,es.is_submitted,es.total_score,es.submitted_at FROM users u LEFT JOIN exercise_status es ON u.id=es.user_id WHERE u.role='student' ORDER BY u.display_name`);
        const submitted=students.filter(s=>s.is_submitted);
        const classAvg=submitted.length?Math.round(submitted.reduce((s,r)=>s+r.total_score,0)/submitted.length*10)/10:0;
        const errorAnalysis={};
        for(let qn=1;qn<=totalQ;qn++){
            const [rows]=await pool.execute(`SELECT s.answer,s.answer2,s.is_correct,u.display_name FROM submissions s JOIN users u ON u.id=s.user_id JOIN exercise_status es ON es.user_id=s.user_id WHERE s.question_num=? AND es.is_submitted=1`,[qn]);
            const wrong=rows.filter(r=>!r.is_correct);
            errorAnalysis[qn]={total:rows.length,wrong:wrong.length,
                rate:rows.length?Math.round(wrong.length/rows.length*100):0,
                wrongAnswers:wrong.map(w=>({answer:w.answer+(w.answer2?' / '+w.answer2:''),name:w.display_name}))};
        }
        const qi={}; for(const [qn,q] of Object.entries(questions)) qi[qn]={pronoun:q.pronoun,type:q.type};
        res.json({ok:true,students,submittedCount:submitted.length,classAvg,totalQ,errorAnalysis,questionInfo:qi});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/admin-action', reqLoginAPI, async(req,res)=>{
    if(!isAdm(req)) return res.json({ok:false,error:'Not admin'});
    try{
        const {action}=req.body;
        switch(action){
            case 'add_student':{
                const {username,displayName,password}=req.body;
                if(!username||!displayName||!password) return res.json({ok:false,error:'All fields required'});
                const [ex]=await pool.execute('SELECT COUNT(*) as c FROM users WHERE username=?',[username]);
                if(ex[0].c>0) return res.json({ok:false,error:'Username already exists!'});
                const h=await bcrypt.hash(password,10);
                await pool.execute('INSERT INTO users (username,password,display_name,role) VALUES (?,?,?,?)',[username,h,displayName,'student']);
                return res.json({ok:true,msg:`Student '${displayName}' added.`}); }
            case 'reset_password':{
                const {studentId,newPassword}=req.body;
                const h=await bcrypt.hash(newPassword,10);
                await pool.execute('UPDATE users SET password=? WHERE id=? AND role="student"',[h,parseInt(studentId)]);
                return res.json({ok:true,msg:'Password reset.'}); }
            case 'delete_student':{
                await pool.execute('DELETE FROM users WHERE id=? AND role="student"',[parseInt(req.body.studentId)]);
                return res.json({ok:true,msg:'Student deleted.'}); }
            case 'reset_submission':{
                const sid=parseInt(req.body.studentId);
                await pool.execute('DELETE FROM submissions WHERE user_id=?',[sid]);
                await pool.execute('DELETE FROM exercise_status WHERE user_id=?',[sid]);
                return res.json({ok:true,msg:'Submission reset.'}); }
            case 'override_score':{
                const sid=parseInt(req.body.studentId),qn=parseInt(req.body.questionNum),ns=parseInt(req.body.newScore);
                await pool.execute('UPDATE submissions SET is_correct=?,score=? WHERE user_id=? AND question_num=?',[ns,ns,sid,qn]);
                const [t]=await pool.execute('SELECT SUM(score) as total FROM submissions WHERE user_id=?',[sid]);
                await pool.execute('UPDATE exercise_status SET total_score=? WHERE user_id=?',[t[0].total||0,sid]);
                return res.json({ok:true,msg:'Score updated.'}); }
            default: return res.json({ok:false,error:'Unknown action'});
        }
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

app.post('/api/get-student-detail', reqLoginAPI, async(req,res)=>{
    if(!isAdm(req)) return res.json({ok:false});
    try{
        const sid=parseInt(req.body.studentId); const questions=getQuestions();
        const [subs]=await pool.execute('SELECT * FROM submissions WHERE user_id=? ORDER BY question_num',[sid]);
        const sm={}; subs.forEach(r=>{sm[r.question_num]=r;});
        const answers=[];
        for(const [qnS,q] of Object.entries(questions)){
            const qn=parseInt(qnS); const sub=sm[qn]||null;
            let sa,ca;
            if(q.type==='former_latter'){sa='Former: '+(sub?sub.answer:'')+' | Latter: '+(sub?sub.answer2:'');ca='Former: '+q.answer_former+' | Latter: '+q.answer_latter;}
            else{sa=sub?sub.answer:'';ca=q.answer;}
            answers.push({qnum:qn,pronoun:q.pronoun,student_answer:sa,correct_answer:ca,is_correct:sub?sub.is_correct:0});
        }
        res.json({ok:true,answers});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});

// Messages
app.post('/api/send-message', reqLoginAPI, async(req,res)=>{
    try{
        let {receiverId,subject,body}=req.body;
        if(!body||!body.trim()) return res.json({ok:false,error:'Message empty'});
        if(!isAdm(req)){const [a]=await pool.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");receiverId=a[0].id;}
        await pool.execute('INSERT INTO messages (sender_id,receiver_id,subject,body) VALUES (?,?,?,?)',
            [req.session.userId,parseInt(receiverId),subject||'',body.trim()]);
        res.json({ok:true});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});
app.get('/api/messages', reqLoginAPI, async(req,res)=>{
    try{
        const uid=req.session.userId;
        const [msgs]=await pool.execute(`SELECT m.*,u.display_name as sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.receiver_id=? OR m.sender_id=? ORDER BY m.created_at DESC`,[uid,uid]);
        res.json({ok:true,messages:msgs});
    }catch(e){console.error(e);res.json({ok:false,error:'Server error'});}
});
app.post('/api/read-message', reqLoginAPI, async(req,res)=>{
    try{await pool.execute('UPDATE messages SET is_read=1 WHERE id=? AND receiver_id=?',[parseInt(req.body.messageId),req.session.userId]);res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.get('/api/unread-count', reqLoginAPI, async(req,res)=>{
    try{const [r]=await pool.execute('SELECT COUNT(*) as c FROM messages WHERE receiver_id=? AND is_read=0',[req.session.userId]);res.json({ok:true,count:r[0].c});}catch(e){res.json({ok:true,count:0});}
});
app.get('/api/students-list', reqLoginAPI, async(req,res)=>{
    if(!isAdm(req)){const [a]=await pool.execute("SELECT id,display_name FROM users WHERE role='admin' LIMIT 1");return res.json({ok:true,contacts:a});}
    const [s]=await pool.execute("SELECT id,display_name FROM users WHERE role='student' ORDER BY display_name");
    res.json({ok:true,contacts:s});
});

app.listen(PORT, ()=>console.log(`✅ Grace Exercise Server running on port ${PORT}`));
