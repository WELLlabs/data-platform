# Setup
Clone the repositories (for https, copy link from github)
```bash
git@github.com:WELLlabs/s3-handler.git
git@github.com:WELLlabs/open-data-portal.git
```
To update the git repository for any new changes,
```bash
git pull
```

# Create SSL Certificate
Recommended method of installing certbot
```bash
sudo apt update
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```
or else
```bash
sudo apt update
sudo apt-get install certbot
```
run the following to generate the certificates
```bash
sudo certbot certonly --standalone --preferred-challenges http -d data.welllabs.org
```
you will recieve the following message.
```
Certificate is saved at: /etc/letsencrypt/live/data.welllabs.org/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/data.welllabs.org/privkey.pem
This certificate expires on {date}.
These files will be updated when the certificate renews.
Certbot has set up a scheduled task to automatically renew this certificate in the background.
```

# AWS Elastic IP address
1. Log in to the AWS Management Console and navigate to the EC2 service
2. In the left sidebar, scroll down to Network & Security and select Elastic IPs
3. Click Allocate Elastic IP address
4. Accept the default settings (Amazon's pool of IPv4 addresses) and click Allocate
5. Select the newly allocated Elastic IP, click Actions, then Associate Elastic IP address
6. Select your EC2 instance from the dropdown menu
7. Select the corresponding private IP address
8. Click Associate

# AWS IAM Policy
1. AWS Console --> IAM --> Policies --> Create policy
2. choose JSON
3. Add the following in the editor
```JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketLevelPermissions",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name"
    },
    {
      "Sid": "S3ObjectLevelPermissions",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```
Enter policy name: DataPortal-S3-Presigned-Policy --> Create Policy

# AWS IAM Role
1. AWS Console --> IAM --> Roles --> Create Role
2. select AWS service and choose EC2 in use case
3. In Add Permissions --> search DataPortal-S3-Presigned-Policy --> select --> next
4. Role Name = DataPortal-S3-Presigned-Role --> create role

# Attach IAM Role to EC2 Instance
1. EC2 Console --> select instance
2. Actions → Security → Modify IAM role
3. select DataPortal-S3-Presigned-Role --> Click Update IAM role

# Important Points
1. copy `.env.template` to `.env` and make necessary changes
2. place the SSL Certificate & Key file in the `src/web/nginx` directory as 
`ssl.crt` & `ssl.key`

# Alembic
run from the open-data-portal(root of project) directory,
if running in local environment with docker for postgres, change db in POSTGRES_URL to localhost and revert back after using alembic
```bash
uv run --directory src/api alembic init migrations
uv run --directory src/api alembic revision --autogenerate -m "init schema"
uv run --directory src/api alembic upgrade head
```

# Docker Compose
Before executing the docker compose, build the s3handler image. (run in s3-handler repo directory)
```bash
docker build -t s3handler .
```

then run the docker compose
```bash
docker compose -f docker-compose.yml up -d --build
```
for development where database is a local instance, run
```bash
docker compose -f docker-compose.dev.yml up -d --build
```

# Configure
Open the organizations table in pgAdmin4, create a column for WELL Labs
```
Id = well-labs
name = WELL Labs
private = true
contributions = 0
```
save changes to the table
