/**
 * Staging Mail & Notification Sandbox Service
 * 
 * Enforces strict environment isolation per context/05_data_security_context.md §9
 * and context/06_testing_deployment_context.md §9:
 * "No signing invitations or portal notifications sent to real clients during testing."
 * 
 * Intercepts outbound signing invitations and notifications in staging/test environments,
 * routing all deliveries to a secure local sandbox (e.g. Mailpit) or in-memory capture buffer.
 */

import { config } from '../config.js';

export class SandboxMailService {
  constructor(options = {}) {
    this.sandboxMode = options.sandboxMode !== undefined ? options.sandboxMode : true;
    this.allowedSandboxDomains = new Set([
      'test.local',
      'staging.trinova.local',
      'mailpit.local',
      'example.com',
      'localhost'
    ]);
    this.outbox = [];
  }

  /**
   * Determines if a recipient email is safe for delivery.
   * In staging, only whitelisted sandbox/test domains are permitted for delivery.
   * Real customer domains are strictly intercepted and prevented from external dispatch.
   */
  isWhitelistedSandboxDomain(email) {
    if (!email || typeof email !== 'string') return false;
    const domain = email.split('@')[1]?.toLowerCase();
    return this.allowedSandboxDomains.has(domain);
  }

  /**
   * Dispatches or intercepts a signing invitation email.
   */
  dispatchSigningInvitation({ signingRequest, signer }) {
    const isWhitelisted = this.isWhitelistedSandboxDomain(signer.email);
    const intercepted = !isWhitelisted && this.sandboxMode;

    const record = {
      id: `mail_inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'SIGNING_INVITATION',
      requestId: signingRequest.id,
      companyId: signingRequest.companyId,
      originalRecipient: signer.email,
      effectiveRecipient: intercepted ? 'sandbox-trap@mailpit.local' : signer.email,
      recipientName: signer.name,
      subject: `Trinova: Signature Required for ${signingRequest.title || signingRequest.originalFilename}`,
      invitationUrl: signer.invitationUrl,
      invitationToken: signer.invitationToken,
      intercepted,
      deliveredToRealNetwork: false, // Always false in sandbox/staging
      timestamp: new Date().toISOString()
    };

    this.outbox.push(record);
    return record;
  }

  /**
   * Dispatches or intercepts a portal message notification.
   */
  dispatchPortalNotification({ recipientEmail, recipientName, title, body, metadata = {} }) {
    const isWhitelisted = this.isWhitelistedSandboxDomain(recipientEmail);
    const intercepted = !isWhitelisted && this.sandboxMode;

    const record = {
      id: `mail_notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'PORTAL_NOTIFICATION',
      originalRecipient: recipientEmail,
      effectiveRecipient: intercepted ? 'sandbox-trap@mailpit.local' : recipientEmail,
      recipientName,
      subject: title,
      bodyPreview: body.substring(0, 100),
      metadata,
      intercepted,
      deliveredToRealNetwork: false,
      timestamp: new Date().toISOString()
    };

    this.outbox.push(record);
    return record;
  }

  /**
   * Returns all captured messages.
   */
  getOutbox() {
    return [...this.outbox];
  }

  /**
   * Returns captured messages matching a recipient email.
   */
  getOutboxFor(email) {
    const target = String(email).toLowerCase();
    return this.outbox.filter(m => m.originalRecipient.toLowerCase() === target);
  }

  /**
   * Clears all captured messages (for test tear-down).
   */
  clear() {
    this.outbox = [];
  }
}

export const sandboxMailService = new SandboxMailService();
