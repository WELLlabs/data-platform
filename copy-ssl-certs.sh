#!/bin/bash

# Certbot Deploy Hook for Docker Nginx
# This script copies SSL certificates to project directory and restarts Nginx container

set -e  # Exit on any error

# Configuration
DOMAIN="data.welllabs.org"
CERT_DIR="/home/ubuntu/.ssl-certs/${DOMAIN}"
NGINX_CONTAINER="frontend"  # Change to your container name

# Check if this renewal is for our domain
if echo "$RENEWED_DOMAINS" | grep -q "$DOMAIN"; then
    
    echo "$(date): Certificate renewed for $DOMAIN" >> /home/ubuntu/.ssl-certs/cert-renewal.log
    
    # Create certificate directory if it doesn't exist
    mkdir -p "$CERT_DIR"
    
    # Set umask to ensure secure permissions during copy
    umask 077
    
    # Copy certificates from Let's Encrypt to project directory
    cp "$RENEWED_LINEAGE/fullchain.pem" "$CERT_DIR/fullchain.pem"
    cp "$RENEWED_LINEAGE/privkey.pem" "$CERT_DIR/privkey.pem"
    
    # Set correct ownership (adjust 'user' to your actual username)
    chown ubuntu:ubuntu "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"
    
    # Set correct permissions
    chmod 644 "$CERT_DIR/fullchain.pem"  # Certificate is public
    chmod 600 "$CERT_DIR/privkey.pem"    # Private key must be protected
    
    # Reload Nginx in Docker container (graceful reload, no downtime)
    docker compose -f docker-compose.prod.yml exec "$NGINX_CONTAINER" nginx -s reload
    
    echo "$(date): Certificates copied and Nginx reloaded successfully" >> /home/ubuntu/.ssl-certs/cert-renewal.log
else
    echo "$(date): Renewal triggered but not for $DOMAIN (got: $RENEWED_DOMAINS)" >> /home/ubuntu/.ssl-certs/cert-renewal.log
fi
