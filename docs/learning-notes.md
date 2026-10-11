# Phone ↔ Laptop Communication Lab (BLE + WiFi + AWS)

Goal: Bina koi hardware kharide, BLE aur WiFi communication ko andar se samajhna, aur end mein sab AWS pe deploy karna.

---

## 1. Big Picture

```
[Phone: nRF Connect]
   (BLE GATT Server)
        |
        | BLE (local radio, ~10m)
        v
[Laptop Chrome: React app]  --- Web Bluetooth API
        |
        | WSS (internet)
        v
[AWS EC2: Node.js + ws server]  <--- Nginx (HTTPS/WSS)
        |
        | WSS
        v
[Dashboard on any other device]
```

**Zaroori baat:** BLE ek local radio hai. Wo AWS pe deploy nahi hota. AWS pe jo deploy hoga: (1) React app (HTTPS ke saath) aur (2) WebSocket relay server. BLE wala hissa hamesha laptop/phone ke paas physically rahega.

**Kyun HTTPS chahiye:** Web Bluetooth sirf secure context mein chalta hai (`https://` ya `localhost`). Isliye deployment mein CloudFront + HTTPS zaroori hai.

**Browser support:** Chrome/Edge (desktop + Android). iOS Safari mein Web Bluetooth nahi hai.

---

## 2. Part 1: BLE Basics (Phone → Laptop)

### Concepts jo seekhne hain
- **Advertising**: device bolta hai "main yahan hoon"
- **GATT**: data ka structure. Service → Characteristic → Value
- **UUID**: har service/characteristic ki pehchaan
- **Properties**: Read, Write, Notify
- **Central vs Peripheral**: laptop = central (scan karta hai), phone = peripheral (advertise karta hai)

### Setup (phone pe, Android recommended)
1. Play Store se **nRF Connect for Mobile** install karo
2. Configure GATT Server → Add service (custom UUID, e.g. `12345678-1234-1234-1234-123456789abc`)
3. Us service mein ek characteristic add karo (e.g. `12345678-1234-1234-1234-123456789abd`) with properties: Read, Write, Notify
4. Advertiser tab → naya advertiser banao, service UUID include karo → ON karo

### Laptop pe: Web Bluetooth (React)

```jsx
const SERVICE = '12345678-1234-1234-1234-123456789abc';
const CHAR = '12345678-1234-1234-1234-123456789abd';

export async function connectBLE(onData) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE] }],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);
  const char = await service.getCharacteristic(CHAR);

  // Read once
  const value = await char.readValue();
  onData(new TextDecoder().decode(value));

  // Subscribe to notifications
  await char.startNotifications();
  char.addEventListener('characteristicvaluechanged', (e) => {
    onData(new TextDecoder().decode(e.target.value));
  });

  return { device, char };
}
```

Note: `requestDevice` ko user click (button) ke andar se hi call karna padta hai.

### Experiment ideas
- nRF Connect mein value badlo, laptop pe live dikhe (Notify)
- Laptop se write karo, phone pe value change dikhe
- Distance badhao, RSSI aur disconnect dekho

---

## 3. Part 2: WiFi Basics (WebSocket)

### Concepts
- TCP vs UDP
- HTTP request/response vs WebSocket (persistent, bidirectional)
- HTTP Upgrade handshake (`101 Switching Protocols`)
- IP, port, localhost vs LAN IP vs public IP

### Node.js relay server (`server.js`)

```js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('client connected');
  ws.on('message', (msg) => {
    // broadcast to everyone else
    wss.clients.forEach((c) => {
      if (c !== ws && c.readyState === WebSocket.OPEN) c.send(msg.toString());
    });
  });
});
console.log('WS server on :8080');
```

```bash
npm init -y && npm i ws
node server.js
```

### React se connect
```jsx
const ws = new WebSocket('ws://localhost:8080'); // deployed: wss://api.yourdomain.com
ws.onmessage = (e) => console.log('got', e.data);
ws.send(JSON.stringify({ from: 'laptop', value: 'hello' }));
```

### Local pe test
Phone browser se `http://<laptop-LAN-IP>:8080` side ka client kholo, same WiFi pe. Laptop ka IP: `ipconfig` (Windows) / `ifconfig` (Mac/Linux).

### Wireshark (sirf local `ws://` pe)
- Filter: `tcp.port == 8080`
- Dekho: TCP 3-way handshake (SYN, SYN-ACK, ACK), HTTP Upgrade request, phir WebSocket frames
- Deployed `wss://` pe traffic encrypted hoga, isliye packet learning local mein hi karo

---

## 4. Part 3: BLE + WiFi Jodna

Flow: Phone BLE value badalta hai → laptop Web Bluetooth se pakadta hai → WebSocket se server ko bhejta hai → server baaki sab dashboards ko broadcast karta hai.

```jsx
const ws = new WebSocket(WS_URL);

connectBLE((value) => {
  ws.send(JSON.stringify({ source: 'ble', value, ts: Date.now() }));
});
```

Dashboard (kisi bhi device pe) bas `ws.onmessage` se live values dikhaye.

### Seekhne wali comparison table (khud bharo experiment ke baad)

| | BLE | WiFi |
|---|---|---|
| Range | ~10m | Router tak / internet |
| Speed | Kam | Zyada |
| Power | Bahut kam | Zyada |
| Use case | Sensors, provisioning | Streaming, cloud |

---

## 5. AWS Deployment

### Architecture
- **Frontend**: S3 + CloudFront (HTTPS) → `app.yourdomain.com`
- **Backend**: EC2 (t3.micro) + Nginx + PM2 → `api.yourdomain.com` (WSS)
- **DNS**: Route 53
- **Certificates**: ACM (CloudFront ke liye, `us-east-1` mein), Let's Encrypt/certbot (EC2 Nginx ke liye)

### Step A: Frontend (S3 + CloudFront)
1. `npm run build` karo (WS URL ko env se `wss://api.yourdomain.com` set karo)
2. S3 bucket banao (private, Block Public Access ON)
3. Build output upload karo: `aws s3 sync dist/ s3://<bucket> --delete`
4. CloudFront distribution banao, origin = S3 with **Origin Access Control (OAC)**
5. Default root object: `index.html`. SPA ke liye custom error response: 403/404 → `/index.html` (200)
6. ACM mein certificate request karo (`us-east-1`), DNS validation Route 53 se
7. CloudFront mein alternate domain name + certificate attach karo
8. Route 53: `app.yourdomain.com` → CloudFront (Alias record)
9. Update ke baad cache clear: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`

### Step B: Backend (EC2)
1. EC2 launch: Ubuntu, t3.micro, ek Elastic IP attach karo
2. **Security Group**: 22 (sirf apna IP), 80 aur 443 (anywhere). Port 8080 public mat kholo
3. Node install karo, code clone karo, `npm i`
4. PM2 se chalao:
   ```bash
   npm i -g pm2
   pm2 start server.js --name ble-relay
   pm2 save && pm2 startup
   ```
5. Nginx install karo aur site config:
   ```nginx
   server {
     server_name api.yourdomain.com;

     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 3600s;
     }
   }
   ```
6. Route 53: `api.yourdomain.com` → EC2 Elastic IP (A record)
7. HTTPS: `sudo certbot --nginx -d api.yourdomain.com`
8. Test: browser console mein `new WebSocket('wss://api.yourdomain.com')`

### Step C: Final end-to-end test
1. `https://app.yourdomain.com` laptop Chrome mein kholo
2. "Connect BLE" dabao, phone select karo
3. Doosre device (ya doosre tab) mein dashboard kholo
4. nRF Connect se value badlo. Dashboard pe live update dikhna chahiye

### Security (basic, lekin zaroori)
- WebSocket server pe basic auth: connect karte waqt token check karo (query param ya first message)
- Message size limit lagao: `new WebSocket.Server({ port, maxPayload: 1024 })`
- IAM user/role least privilege, root account use mat karo
- SSH key-only login

### Stretch goals (baad mein)
- Server ko **API Gateway WebSocket + Lambda + DynamoDB** pe shift karo (serverless version)
- ALB + ACM se EC2 ke aage TLS lagao (certbot ki jagah)
- CloudWatch logs aur alarms
- GitHub Actions se auto-deploy (S3 sync + CloudFront invalidation)

---

## 6. Suggested Order (≈7 din)

| Din | Kaam |
|---|---|
| 1 | nRF Connect se aas-paas ke BLE devices explore, GATT server banao |
| 2 | Web Bluetooth demo (read, write, notify) |
| 3 | Node WebSocket server + React client, local |
| 4 | Wireshark se TCP handshake aur WS upgrade dekho |
| 5 | BLE → WS bridge jodo, dashboard banao |
| 6 | AWS: EC2 + Nginx + certbot, WSS chalao |
| 7 | AWS: S3 + CloudFront + Route 53, end-to-end test |

---

## 7. Common Problems

- **`navigator.bluetooth` undefined**: HTTPS/localhost nahi hai, ya browser support nahi
- **Device list mein nahi aa raha**: nRF Connect advertiser ON hai? Filter ka service UUID advertise ho raha hai?
- **`NotSupportedError` / service not found**: UUID lowercase mein likho, aur `optionalServices` check karo
- **WSS connect nahi hota**: Nginx mein `Upgrade`/`Connection` headers, certificate valid hai ya nahi
- **Mixed content error**: HTTPS page se `ws://` call nahi ho sakta, `wss://` hi chahiye
- **CloudFront purana version dikha raha hai**: invalidation chalao

---

## 8. Kya seekha (checklist)

- [ ] BLE advertising, GATT, characteristics, notify
- [ ] Central vs peripheral
- [ ] TCP handshake, HTTP vs WebSocket
- [ ] Web Bluetooth ka secure-context rule
- [ ] BLE vs WiFi trade-offs (khud ki table se)
- [ ] EC2 + Nginx reverse proxy for WebSocket
- [ ] S3 + CloudFront + ACM + Route 53 se HTTPS hosting
