INSERT INTO users(name,email,password_hash,role) VALUES
('Системный администратор','admin@kukla.local',crypt('admin12345',gen_salt('bf',12)),'ADMIN'),
('Руководитель','leader@kukla.local',crypt('leader12345',gen_salt('bf',12)),'LEADER'),
('Координатор','coordinator@kukla.local',crypt('coord12345',gen_salt('bf',12)),'COORDINATOR'),
('Поисковик','searcher@kukla.local',crypt('searcher123',gen_salt('bf',12)),'SEARCHER') ON CONFLICT DO NOTHING;
INSERT INTO searches(title,status,area,description,incident_lat,incident_lng,created_by)
SELECT 'Демонстрационный поиск','ACTIVE','Омская область','Тестовый поиск для проверки KuKLA 2.1',54.9885,73.3242,id FROM users WHERE email='leader@kukla.local' AND NOT EXISTS(SELECT 1 FROM searches WHERE title='Демонстрационный поиск');
