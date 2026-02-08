const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- CONFIGURAÇÃO DE SEGURANÇA (CORS) ---
// Isso permite que o Vercel e o seu Mac conversem com o Render sem bloqueio
app.use(cors({ origin: "*" })); 
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "*", // Libera o Socket.io para qualquer lugar
        methods: ["GET", "POST"]
    }
});

// --- BANCO DE DADOS NA MEMÓRIA ---
let pendingOrders = [];
let activeOrders = [];
let history = [];
let drivers = [];

// --- ROTAS ---

// Rota de Teste (Para saber se está vivo)
app.get('/', (req, res) => {
    res.send('Servidor iGO Logística RODANDO! 🚀');
});

// Painel Dashboard
app.get('/api/dashboard', (req, res) => {
    res.json({ pendingOrders, activeOrders, drivers, history });
});

// Criar Pedido
app.post('/register-delivery', (req, res) => {
    try {
        const { clientName, price, phone, address, lat, lng } = req.body;
        const newOrder = {
            id: Date.now().toString(),
            clientName,
            price,
            phone,
            address,
            storeCoords: { lat: -8.0592, lng: -34.8996 }, // Coordenada Loja (Pode ajustar)
            destCoords: { lat, lng },
            status: 'pending',
            createdAt: new Date().toLocaleString('pt-BR')
        };
        pendingOrders.push(newOrder);
        io.emit('refresh_admin'); // Avisa o painel
        res.status(201).json({ message: 'Pedido criado', order: newOrder });
        console.log("Novo pedido criado:", clientName);
    } catch (error) {
        console.error("Erro ao criar pedido:", error);
        res.status(500).json({ error: "Erro interno" });
    }
});

// Despachar para Motoboy
app.post('/assign-order', (req, res) => {
    const { orderId, driverSocketId } = req.body;
    const orderIndex = pendingOrders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
        const order = pendingOrders.splice(orderIndex, 1)[0];
        const driver = drivers.find(d => d.id === driverSocketId);
        
        if (driver) {
            order.driverName = driver.name;
            order.driverId = driver.id;
            order.status = 'delivering';
            activeOrders.push(order);
            
            io.emit('refresh_admin');
            // Avisa o motoboy específico (se implementado no futuro)
            // io.to(driverSocketId).emit('new_delivery', order); 
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Motoboy não encontrado" });
        }
    } else {
        res.status(404).json({ error: "Pedido não encontrado" });
    }
});

// Motoboy Conecta (GPS)
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);

    socket.on('driver_login', (data) => {
        const existing = drivers.find(d => d.name === data.name);
        if (!existing) {
            drivers.push({ id: socket.id, name: data.name, lat: 0, lng: 0 });
        } else {
            existing.id = socket.id; // Atualiza o socket do motoboy
        }
        io.emit('refresh_admin');
    });

    socket.on('driver_location', (data) => {
        // Atualiza a posição no mapa do admin
        io.emit('update_map', { socketId: socket.id, lat: data.lat, lng: data.lng });
    });

    socket.on('disconnect', () => {
        drivers = drivers.filter(d => d.id !== socket.id);
        io.emit('refresh_admin');
    });
    
    // Chat
    socket.on('send_chat_message', (data) => {
        io.emit('new_chat_message', data);
    });
});

// Resetar Sistema (Zerar Tudo)
app.post('/api/reset-system', (req, res) => {
    pendingOrders = [];
    activeOrders = [];
    history = [];
    io.emit('refresh_admin');
    res.json({ success: true });
});

// Deletar Histórico
app.delete('/delete-history/:id', (req, res) => {
    history = history.filter(h => h.id !== req.params.id);
    io.emit('refresh_admin');
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SERVER RODANDO NA PORTA ${PORT}`);
});
