// backend-api-FIXED-FINAL.js
// Complete Email WarmUp Pro Backend with Actual Email Sending

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://email-warmup-pro.netlify.app',
    ]
}));
app.use(express.json());

// Initialize Firebase Admin
try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin initialized');
} catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    console.error('Make sure serviceAccountKey.json is in the same folder!');
    process.exit(1);
}

const db = admin.firestore();

// In-memory storage for active warm-up sessions
const warmupSessions = new Map();

// Email templates for warm-up
const emailTemplates = {
    subjects: [
        'Quick question',
        'Following up',
        'Thoughts on this?',
        'Checking in',
        'Update',
        'Quick sync',
        'FYI',
        'Heads up',
        'Question for you',
        'Can you help?'
    ],
    bodies: [
        'Hi,\n\nJust wanted to check in and see how things are going.\n\nBest regards',
        'Hello,\n\nHope you\'re doing well. Just touching base.\n\nThanks',
        'Hi there,\n\nQuick update on my end. Let me know your thoughts.\n\nCheers',
        'Hey,\n\nWanted to share this with you. Would love your input.\n\nBest',
        'Hi,\n\nJust following up on our previous conversation.\n\nRegards'
    ],
    replies: [
        'Thanks for reaching out! All good on my end.\n\nBest',
        'Appreciate the update. Sounds great!\n\nThanks',
        'Got it, thanks for letting me know.\n\nCheers',
        'Perfect, I\'ll take a look.\n\nRegards',
        'Thanks! Will get back to you soon.\n\nBest'
    ]
};

// Generate random email content
function generateEmail() {
    const subject = emailTemplates.subjects[Math.floor(Math.random() * emailTemplates.subjects.length)];
    const body = emailTemplates.bodies[Math.floor(Math.random() * emailTemplates.bodies.length)];
    return { subject, body };
}

// Generate reply content
function generateReply() {
    return emailTemplates.replies[Math.floor(Math.random() * emailTemplates.replies.length)];
}

// Create SMTP transporter - FIXED VERSION
function createTransporter(account) {
    console.log(`Creating transporter for: ${account.email}`);
    
    try {
        const transporter = nodemailer.createTransport({
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.port === 465,
            auth: {
                user: account.email,
                pass: account.password
            },
            tls: {
                rejectUnauthorized: false
            },
            debug: true, // Enable debug output
            logger: true // Enable logging
        });
        
        console.log(`✅ Transporter created for ${account.email}`);
        return transporter;
    } catch (error) {
        console.error(`❌ Error creating transporter: ${error.message}`);
        throw error;
    }
}

// Send email function
async function sendEmail(fromAccount, toAccount) {
    try {
        console.log(`\n📤 Attempting to send email: ${fromAccount.email} → ${toAccount.email}`);
        
        const transporter = createTransporter(fromAccount);
        const { subject, body } = generateEmail();

        const mailOptions = {
            from: fromAccount.email,
            to: toAccount.email,
            subject: subject,
            text: body,
            headers: {
                'X-Warmup-Email': 'true',
                'Message-ID': `<${Date.now()}.${fromAccount.email}>`
            }
        };

        console.log(`Mail options prepared:`, mailOptions);
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully! Message ID: ${info.messageId}`);
        
        return {
            success: true,
            messageId: info.messageId,
            from: fromAccount.email,
            to: toAccount.email,
            subject
        };
    } catch (error) {
        console.error(`❌ Error sending email: ${error.message}`);
        console.error(`Stack trace:`, error.stack);
        return {
            success: false,
            error: error.message
        };
    }
}

// Send reply function
async function sendReply(fromAccount, toAccount, originalSubject) {
    try {
        console.log(`\n📥 Attempting to send reply: ${fromAccount.email} → ${toAccount.email}`);
        
        const transporter = createTransporter(fromAccount);
        const replyBody = generateReply();

        const mailOptions = {
            from: fromAccount.email,
            to: toAccount.email,
            subject: `Re: ${originalSubject}`,
            text: replyBody,
            headers: {
                'X-Warmup-Email': 'true'
            }
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Reply sent successfully! Message ID: ${info.messageId}`);
        
        return {
            success: true,
            messageId: info.messageId
        };
    } catch (error) {
        console.error(`❌ Error sending reply: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

// Middleware to verify Firebase token
async function authenticateUser(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
}

// Start warm-up session
app.post('/api/warmup/start', authenticateUser, async (req, res) => {
    const { accounts, settings } = req.body;
    const userId = req.user.uid;

    console.log(`\n🚀 Starting warm-up for user: ${userId}`);
    console.log(`📊 Accounts: ${accounts.length}, Emails/day: ${settings.emailsPerDay}, Reply rate: ${settings.replyRate}%`);

    if (!accounts || accounts.length < 2) {
        return res.status(400).json({ error: 'Minimum 2 accounts required' });
    }

    if (accounts.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 accounts allowed' });
    }

    const sessionId = `${userId}_${Date.now()}`;
    
    // Initialize session
    const session = {
        id: sessionId,
        userId,
        accounts,
        settings: {
            emailsPerDay: settings.emailsPerDay || 10,
            replyRate: settings.replyRate || 80,
            minReplyDelay: settings.minReplyDelay || 1,
            maxReplyDelay: settings.maxReplyDelay || 5
        },
        stats: {
            totalSent: 0,
            totalReplies: 0,
            startTime: Date.now(),
            nextEmailTime: null
        },
        active: true
    };

    warmupSessions.set(sessionId, session);

    // Calculate interval based on emails per day
    const intervalMs = (24 * 60 * 60 * 1000) / settings.emailsPerDay;
    const intervalMinutes = (intervalMs / 1000 / 60).toFixed(1);
    console.log(`⏱️  Email interval: ${intervalMinutes} minutes`);

    // Function to send one warm-up email
    const sendWarmupEmail = async () => {
        if (!warmupSessions.get(sessionId)?.active) {
            console.log('⏹️  Session stopped, clearing interval');
            return;
        }

        try {
            // Select random sender and receiver
            const senderIndex = Math.floor(Math.random() * accounts.length);
            let receiverIndex;
            do {
                receiverIndex = Math.floor(Math.random() * accounts.length);
            } while (receiverIndex === senderIndex);

            const sender = accounts[senderIndex];
            const receiver = accounts[receiverIndex];

            // Send the email
            const result = await sendEmail(sender, receiver);
            
            if (result.success) {
                session.stats.totalSent++;
                
                // Calculate next email time
                const nextTime = Date.now() + intervalMs;
                session.stats.nextEmailTime = nextTime;
                
                // Update Firestore stats
                try {
                    await db.collection('users').doc(userId).collection('accounts').doc(sender.id).update({
                        emailsSent: admin.firestore.FieldValue.increment(1)
                    });
                    await db.collection('users').doc(userId).collection('accounts').doc(receiver.id).update({
                        emailsReceived: admin.firestore.FieldValue.increment(1)
                    });
                    
                    // Add activity log
                    await db.collection('users').doc(userId).collection('activity').add({
                        text: `📧 ${sender.email} → ${receiver.email}`,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    // Add next email notification
                    const nextEmailDate = new Date(nextTime);
                    await db.collection('users').doc(userId).collection('activity').add({
                        text: `⏰ Next email will be sent at ${nextEmailDate.toLocaleTimeString()} (in ${intervalMinutes} minutes)`,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (dbError) {
                    console.error('Error updating Firestore:', dbError.message);
                }

                // Decide if this email should be replied to
                const shouldReply = Math.random() * 100 < settings.replyRate;

                if (shouldReply) {
                    // Calculate random delay
                    const delayMinutes = settings.minReplyDelay + Math.random() * (settings.maxReplyDelay - settings.minReplyDelay);
                    const delayMs = delayMinutes * 60 * 1000;

                    console.log(`⏱️  Reply scheduled in ${delayMinutes.toFixed(1)} minutes`);

                    // Log the scheduled reply
                    try {
                        await db.collection('users').doc(userId).collection('activity').add({
                            text: `⏱️ ${receiver.email} will reply in ${delayMinutes.toFixed(1)} minutes`,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } catch (dbError) {
                        console.error('Error logging activity:', dbError.message);
                    }

                    // Schedule reply
                    setTimeout(async () => {
                        if (!warmupSessions.get(sessionId)?.active) return;

                        const replyResult = await sendReply(receiver, sender, result.subject);
                        
                        if (replyResult.success) {
                            session.stats.totalReplies++;
                            
                            // Update Firestore
                            try {
                                await db.collection('users').doc(userId).collection('accounts').doc(receiver.id).update({
                                    emailsSent: admin.firestore.FieldValue.increment(1)
                                });
                                await db.collection('users').doc(userId).collection('accounts').doc(sender.id).update({
                                    emailsReceived: admin.firestore.FieldValue.increment(1)
                                });
                                
                                // Add activity log
                                await db.collection('users').doc(userId).collection('activity').add({
                                    text: `↩️ ${receiver.email} replied to ${sender.email}`,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                                });
                            } catch (dbError) {
                                console.error('Error updating Firestore:', dbError.message);
                            }
                        }
                    }, delayMs);
                } else {
                    console.log(`📭 No reply (${100 - settings.replyRate}% chance)`);
                    
                    // Log no reply
                    try {
                        await db.collection('users').doc(userId).collection('activity').add({
                            text: `📭 ${receiver.email} received (no reply - ${100 - settings.replyRate}% chance)`,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } catch (dbError) {
                        console.error('Error logging activity:', dbError.message);
                    }
                }
            } else {
                // Log error to activity
                try {
                    await db.collection('users').doc(userId).collection('activity').add({
                        text: `❌ Failed to send email: ${result.error}`,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (dbError) {
                    console.error('Error logging error:', dbError.message);
                }
            }
        } catch (error) {
            console.error('Error in warm-up cycle:', error);
        }
    };

    // Send first email immediately
    console.log('Sending first email in 2 seconds...');
    setTimeout(sendWarmupEmail, 2000);

    // Schedule subsequent emails
    session.sendInterval = setInterval(sendWarmupEmail, intervalMs);

    console.log(`✅ Warm-up session started: ${sessionId}\n`);

    res.json({
        success: true,
        sessionId,
        message: 'Warm-up started successfully',
        intervalMinutes: intervalMinutes
    });
});

// Stop warm-up session
app.post('/api/warmup/stop', authenticateUser, async (req, res) => {
    const { sessionId } = req.body;
    const session = warmupSessions.get(sessionId);

    console.log(`\n⏹️  Stopping warm-up session: ${sessionId}`);

    if (!session || session.userId !== req.user.uid) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Stop sending interval
    if (session.sendInterval) {
        clearInterval(session.sendInterval);
    }

    session.active = false;

    console.log(`📊 Final stats - Sent: ${session.stats.totalSent}, Replies: ${session.stats.totalReplies}\n`);

    res.json({
        success: true,
        message: 'Warm-up stopped successfully',
        stats: session.stats
    });
});

// Get session statistics
app.get('/api/warmup/stats/:sessionId', authenticateUser, async (req, res) => {
    const { sessionId } = req.params;
    const session = warmupSessions.get(sessionId);

    if (!session || session.userId !== req.user.uid) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const uptime = Date.now() - session.stats.startTime;

    res.json({
        success: true,
        stats: {
            ...session.stats,
            uptime,
            active: session.active,
            accountCount: session.accounts.length
        }
    });
});

// Test email account connection
app.post('/api/account/test', authenticateUser, async (req, res) => {
    const { account } = req.body;

    console.log(`\n🔍 Testing account: ${account.email}`);

    try {
        // Test SMTP
        const transporter = createTransporter(account);
        await transporter.verify();
        console.log(`✅ SMTP connection successful for ${account.email}`);

        res.json({
            success: true,
            message: 'Account connection successful'
        });
    } catch (error) {
        console.error(`❌ Connection failed for ${account.email}:`, error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeSessions: warmupSessions.size,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Email WarmUp Pro API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/api/health\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n⏹️  SIGTERM received, shutting down gracefully...');
    
    // Stop all sessions
    warmupSessions.forEach((session) => {
        if (session.sendInterval) {
            clearInterval(session.sendInterval);
        }
    });

    process.exit(0);
});
