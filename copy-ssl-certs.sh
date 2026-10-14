#!/bin/bash

# Certbot deploy hook for the data-platform container.
# Copies renewed certificates to /etc/data-platform/ssl and reloads Nginx.
# Install this script at /etc/letsencrypt/renewal-hooks/deploy/.

set -e  # Exit on any error

# Configuration
DOMAIN="data.welllabs.org"
CERT_DIR="/etc/data-platform/ssl"
CONTAINER="data-platform"
LOG_FILE="/var/log/data-platform-cert-renewal.log"

# Check if this renewal is for our domain
if echo "$RENEWED_DOMAINS" | grep -q "$DOMAIN"; then

    echo "$(date): Certificate renewed for $DOMAIN" >> "$LOG_FILE"

    # Create certificate directory if it doesn't exist
    mkdir -p "$CERT_DIR"

    # Set umask to ensure secure permissions during copy
    umask 077

    # Copy certificates from Let's Encrypt (follows the live/ symlinks)
    cp "$RENEWED_LINEAGE/fullchain.pem" "$CERT_DIR/fullchain.pem"
    cp "$RENEWED_LINEAGE/privkey.pem" "$CERT_DIR/privkey.pem"

    chown root:root "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"

    # Set correct permissions
    chmod 644 "$CERT_DIR/fullchain.pem"  # Certificate is public
    chmod 600 "$CERT_DIR/privkey.pem"    # Private key must be protected

    # Reload Nginx in the single container (graceful reload, no downtime)
    docker exec "$CONTAINER" nginx -s reload

    echo "$(date): Certificates copied and Nginx reloaded successfully" >> "$LOG_FILE"
else
    echo "$(date): Renewal triggered but not for $DOMAIN (got: $RENEWED_DOMAINS)" >> "$LOG_FILE"
fi
