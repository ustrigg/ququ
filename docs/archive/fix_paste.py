#!/usr/bin/env python3
# Script to fix the paste issue in main.js

import re

# Read the file
with open('C:/n8n/ququ/main.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Old code pattern
old_code = '''// Handle auto-paste text at cursor
ipcMain.handle('auto-paste-text', async (event, text) => {
  return new Promise((resolve, reject) => {
    console.log('[Auto-Paste] Attempting to paste text:', text.substring(0, 50) + '...');

    // Use Base64 encoding to avoid all escaping issues
    const base64Text = Buffer.from(text, 'utf-8').toString('base64');

    // PowerShell script using Base64 to avoid escaping issues
    const psCommand = `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Text}')); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($text); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^v')`;'''

# New code with fix
new_code = '''// Handle auto-paste text at cursor
ipcMain.handle('auto-paste-text', async (event, text) => {
  return new Promise(async (resolve, reject) => {
    console.log('[Auto-Paste] Attempting to paste text:', text.substring(0, 50) + '...');

    // CRITICAL: Hide the ququ window first to return focus to the target application
    // The mainWindow has alwaysOnTop: true, so it may be stealing focus
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Auto-Paste] Hiding main window to return focus to target app...');
      mainWindow.hide();
      // Wait for focus to return to the previous window
      await new Promise(r => setTimeout(r, 200));
    }

    // Use Base64 encoding to avoid all escaping issues
    const base64Text = Buffer.from(text, 'utf-8').toString('base64');

    // PowerShell script using Base64 to avoid escaping issues
    // Added extra delay to ensure focus has returned to target window
    const psCommand = `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Text}')); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($text); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('^v')`;'''

# Replace
if old_code in content:
    content = content.replace(old_code, new_code)
    with open('C:/n8n/ququ/main.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: main.js updated successfully!')
else:
    print('ERROR: Old code pattern not found. File may have already been modified.')
