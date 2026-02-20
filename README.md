create an environment file in backend file with below details first:

PORT=5050
MONGO_URI=mongodb://127.0.0.1:27017/iot_lab_system
JWT_SECRET=supersecretkey
JWT_EXPIRES_IN=1d


MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=yourmail
MAIL_PASS=yourappkey


GEMINI_API_KEY=yourkeyfor2.5flash


FRONTEND_URL=http://localhost:8080




//
to start backend:
cd backend
then:
 nodemon ./src/server.js

