// src/controller/adminWhatsappController.js
import * as adminWhatsappModel from '../model/adminWhatsappModel.js';
import { createBaileysClient } from '../service/baileysAdapter.js';
import { sendSuccess } from '../utils/response.js';
import { extractPhoneDigits } from '../utils/waHelper.js';
import { rm } from 'fs/promises';

// Store active registration sessions
const registrationSessions = new Map();

/**
 * Cleanup a registration session
 */
async function cleanupSession(sessionId, sessionInfo) {
  try {
    if (sessionInfo.client) {
      await sessionInfo.client.disconnect();
      console.log(`[ADMIN_REG] Disconnected session ${sessionId}`);
      
      // Clean up session files
      if (sessionInfo.client.sessionPath) {
        await rm(sessionInfo.client.sessionPath, { recursive: true, force: true });
        console.log(`[ADMIN_REG] Cleaned up session files for ${sessionId}`);
      }
    }
    registrationSessions.delete(sessionId);
  } catch (err) {
    console.warn(`[ADMIN_REG] Failed to cleanup session ${sessionId}:`, err.message);
  }
}

/**
 * Start admin WhatsApp registration
 * Generates QR code for Baileys pairing
 */
export async function startRegistration(req, res, next) {
  try {
    const { registered_by = 'self', notes = null } = req.body;
    
    // Generate unique session ID
    const sessionId = `admin-reg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Create a temporary Baileys client for registration
    const regClient = await createBaileysClient(sessionId);
    
    let qrData = null;
    let phoneNumber = null;
    let resolved = false;
    
    // Listen for QR code
    regClient.on('qr', (qr) => {
      console.log(`[ADMIN_REG] QR code generated for session ${sessionId}`);
      qrData = qr;
      
      // Send QR immediately if not yet sent
      if (!resolved) {
        resolved = true;
        res.json({
          success: true,
          sessionId,
          qr: qrData,
          status: 'awaiting_scan',
          message: 'Scan QR code dengan WhatsApp Anda untuk mendaftar sebagai admin'
        });
      }
    });
    
    // Listen for ready (authenticated)
    regClient.on('ready', async () => {
      try {
        console.log(`[ADMIN_REG] Session ${sessionId} authenticated`);
        
        // Get authenticated phone number
        // Try to get from Baileys creds
        const authState = regClient.state || {};
        const creds = authState.creds || {};
        const me = creds.me || {};
        
        if (me.id) {
          // Extract phone from ID like "62812345678@s.whatsapp.net"
          const phoneMatch = me.id.match(/^(\d+)@/);
          if (phoneMatch) {
            phoneNumber = phoneMatch[1];
            console.log(`[ADMIN_REG] Extracted phone number: ${phoneNumber}`);
            
            // Register admin in database
            await adminWhatsappModel.create(phoneNumber, registered_by, notes);
            console.log(`[ADMIN_REG] Successfully registered admin: ${phoneNumber}`);
            
            // Send success message via WhatsApp
            try {
              await regClient.sendMessage(
                me.id,
                '✅ Selamat! Nomor WhatsApp Anda telah berhasil terdaftar sebagai admin Cicero.'
              );
            } catch (err) {
              console.warn('[ADMIN_REG] Failed to send confirmation message:', err.message);
            }
            
            // Store success in session
            const session = registrationSessions.get(sessionId);
            if (session) {
              session.phoneNumber = phoneNumber;
              session.status = 'registered';
            }
          }
        }
        
        // Disconnect the registration client
        setTimeout(async () => {
          const sessionInfo = registrationSessions.get(sessionId);
          if (sessionInfo) {
            await cleanupSession(sessionId, sessionInfo);
          }
        }, 5000);
      } catch (err) {
        console.error(`[ADMIN_REG] Error in ready handler for ${sessionId}:`, err.message);
      }
    });
    
    // Store session info
    registrationSessions.set(sessionId, {
      client: regClient,
      createdAt: Date.now(),
      status: 'pending',
      phoneNumber: null,
      registered_by,
      notes
    });
    
    // Start connection
    await regClient.connect();
    
    // Set timeout to cleanup if not completed
    setTimeout(() => {
      const session = registrationSessions.get(sessionId);
      if (session && session.status === 'pending') {
        console.log(`[ADMIN_REG] Session ${sessionId} timed out`);
        cleanupSession(sessionId, session);
      }
    }, 180000); // 3 minutes timeout
    
    // If QR was already generated, response was already sent
    // Otherwise, wait a bit and send timeout
    if (!resolved) {
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          res.status(408).json({
            success: false,
            message: 'QR code generation timeout'
          });
        }
      }, 30000); // 30 seconds timeout for QR generation
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Check registration status
 */
export async function checkRegistrationStatus(req, res, next) {
  try {
    const { sessionId } = req.params;
    
    const session = registrationSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or expired'
      });
    }
    
    res.json({
      success: true,
      status: session.status,
      phoneNumber: session.phoneNumber,
      createdAt: session.createdAt
    });
    
    // Clean up completed sessions
    if (session.status === 'registered') {
      registrationSessions.delete(sessionId);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * List all admin WhatsApp numbers
 */
export async function listAdmins(req, res, next) {
  try {
    // Verify requestor is admin
    if (req.dashboardUser && req.dashboardUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const includeInactive = req.query.includeInactive === 'true';
    const admins = includeInactive
      ? await adminWhatsappModel.findAllIncludingInactive()
      : await adminWhatsappModel.findAll();
    
    sendSuccess(res, admins);
  } catch (err) {
    next(err);
  }
}

/**
 * Deactivate an admin WhatsApp number
 */
export async function deactivateAdmin(req, res, next) {
  try {
    // Verify requestor is admin
    if (req.dashboardUser && req.dashboardUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const { whatsapp } = req.params;
    const result = await adminWhatsappModel.deactivate(whatsapp);
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * Check if current WhatsApp number is admin
 */
export async function checkIsAdmin(req, res, next) {
  try {
    const { whatsapp } = req.query;
    
    if (!whatsapp) {
      return res.status(400).json({ success: false, message: 'WhatsApp number required' });
    }
    
    const normalized = extractPhoneDigits(whatsapp);
    const isAdminEnv = (process.env.ADMIN_WHATSAPP || '')
      .split(',')
      .map(n => n.trim().replace(/\D/g, ''))
      .filter(Boolean)
      .includes(normalized);
    
    const isAdminDb = await adminWhatsappModel.isAdmin(whatsapp);
    
    res.json({
      success: true,
      isAdmin: isAdminEnv || isAdminDb,
      source: isAdminEnv ? 'env' : (isAdminDb ? 'database' : 'none')
    });
  } catch (err) {
    next(err);
  }
}
