/**
 * src/components/QRCodeDisplay.tsx
 * 
 * Mobile-friendly QR code display component.
 * Renders a high-contrast, scalable SVG QR Code encoding the short deep-link /share/<shareId>,
 * along with one-tap copy and quick student testing shortcuts.
 */

import React, { useState, useMemo } from 'react';
import { generateQRMatrix, generateQRSVGPath } from '../utils/qrCode';

export interface QRCodeDisplayProps {
  shareId: string;
  shareUrl?: string;
  title: string;
  type: string;
  isNewlyPublished?: boolean;
  onClose?: () => void;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  shareId,
  shareUrl,
  title,
  type,
  isNewlyPublished = false,
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  // Compute the full public share URL for phone scanning
  const resolvedUrl = useMemo(() => {
    if (shareUrl) return shareUrl;
    return `https://bytemind-ai-mentor-lab.onrender.com/share/${shareId}`;
  }, [shareUrl, shareId]);

  // Generate SVG path for the QR matrix
  const { pathData, viewBoxSize } = useMemo(() => {
    try {
      const matrix = generateQRMatrix(resolvedUrl);
      const N = matrix.length;
      const path = generateQRSVGPath(matrix);
      // N + 8 for 4-module quiet zone on all sides
      return { pathData: path, viewBoxSize: N + 8 };
    } catch (err) {
      console.warn('QR generation fallback:', err);
      return { pathData: '', viewBoxSize: 37 };
    }
  }, [resolvedUrl]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(resolvedUrl);
      } else {
        const input = document.createElement('input');
        input.value = resolvedUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy failed:', err);
    }
  };

  const handleDownloadQR = () => {
    try {
      const svg = document.getElementById(`qr-svg-${shareId}`);
      if (!svg) return;
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bytemind-qr-${shareId}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('QR download error:', err);
    }
  };

  const normType = (type || '').toLowerCase();
  const typeIcon = normType === 'quiz' ? '🧠' : normType === 'assignment' ? '📝' : '📘';
  const typeLabel = normType === 'quiz' ? 'Quiz / Test' : normType === 'assignment' ? 'Assignment' : 'Notes';

  return (
    <div className="qr-display-container">
      <div className="qr-header-row">
        <div className="qr-badge-pill">
          <span>{typeIcon}</span>
          <span>{typeLabel}</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="qr-close-btn"
            onClick={onClose}
            aria-label="Close QR display"
          >
            ✕
          </button>
        )}
      </div>

      {isNewlyPublished && (
        <div className="qr-success-banner" role="status">
          <span>✓ Published successfully</span>
        </div>
      )}

      <h3 className="qr-title">{title}</h3>
      <p className="qr-subtitle">Scan with phone camera or open share link:</p>

      {/* SVG QR Code Display */}
      <div className="qr-svg-wrapper">
        <div className="qr-svg-card">
          {pathData ? (
            <svg
              id={`qr-svg-${shareId}`}
              viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
              className="qr-svg-image"
              role="img"
              aria-label={`QR Code for ${title}`}
            >
              <rect width="100%" height="100%" fill="#ffffff" rx="2" />
              <path d={pathData} fill="#0f172a" />
            </svg>
          ) : (
            <div className="qr-fallback-box">
              <span className="qr-fallback-icon">📱</span>
              <code>{shareId}</code>
            </div>
          )}
        </div>
      </div>

      {/* Share ID & URL Box */}
      <div className="qr-code-meta">
        <div className="qr-share-code-row">
          <span className="qr-code-label">Share Code:</span>
          <code className="qr-share-code">{shareId}</code>
        </div>
        <div className="qr-url-text" title={resolvedUrl}>
          {resolvedUrl}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="qr-actions-row">
        <button
          type="button"
          className="qr-btn qr-btn-download"
          onClick={handleDownloadQR}
          title="Download SVG QR Code"
        >
          💾 Download QR
        </button>
        <button
          type="button"
          className="qr-btn qr-btn-copy"
          onClick={handleCopyLink}
          title="Copy share link to clipboard"
        >
          {copied ? '✓ Copied!' : '📋 Copy Link'}
        </button>
      </div>
    </div>
  );
};
