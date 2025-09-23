# Build React app
FROM node:22.19.0-alpine3.21 as build
WORKDIR /app
# ARG REACT_APP_API_HOST
# ENV REACT_APP_API_HOST=$REACT_APP_API_HOST
COPY package*.json ./
RUN npm install
COPY . .
# RUN echo "REACT_APP_API_HOST=$REACT_APP_API_HOST" > .env
RUN npm run build

# Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY ./nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./nginx/ssl.crt /etc/nginx/ssl/ssl.crt
COPY ./nginx/ssl.key /etc/nginx/ssl/ssl.key
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
