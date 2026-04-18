import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  FolderKanban, 
  FileText, 
  Settings, 
  Search, 
  Plus, 
  MoreVertical,
  Database,
  TableProperties,
  Code2,
  Upload,
  Sparkles,
  Download,
  ChevronRight,
  Maximize,
  Minus,
  X,
  Send,
  MessageSquare,
  BoxSelect,
  Server,
  Network
} from 'lucide-react';

// --- MOCK DATA ---
const MOCK_PROJECTS = [
  { 
    id: 1, 
    name: 'Sales Analytics', 
    desc: 'Data model for the sales analytics pipeline across different business units.', 
    modelsCount: 2, 
    date: 'Apr 11, 2026',
    engines: ['Databricks SQL', 'PostgreSQL']
  },
  { 
    id: 2, 
    name: 'HR System Core', 
    desc: 'Employee, payroll and benefits entity definitions.', 
    modelsCount: 1, 
    date: 'Mar 28, 2026',
    engines: ['Oracle']
  }
];

const MOCK_MODELS = [
  { id: 101, name: 'Main Data Model', tables: 12, engine: 'PostgreSQL' },
  { id: 102, name: 'Staging Area Schema', tables: 5, engine: 'Databricks SQL' }
];

const MOCK_TABLES = [
  { id: 1, name: 'users', columns: 5, color: 'bg-teal-600', model: 'Main Data Model' },
  { id: 2, name: 'orders', columns: 4, color: 'bg-teal-600', model: 'Main Data Model' },
  { id: 3, name: 'raw_events', columns: 15, color: 'bg-indigo-600', model: 'Staging Area Schema' }
];

const DBML_CODE = `Table users {
  id integer [primary key]
  username varchar(50)
  email varchar(100)
  created_at timestamp
}

Table orders {
  id integer [primary key]
  user_id integer
  total decimal(10,2)
  status varchar(20)
}

Ref: orders.user_id > users.id`;

// --- COMPONENTS ---

export default function App() {
  const [currentView, setCurrentView] = useState('projects'); // 'projects', 'project-details', 'editor'
  const [activeProject, setActiveProject] = useState(null);
  const [activeModel, setActiveModel] = useState(null); // Si es null pero hay project, es "Vista Global"

  // Layout Wrapper
  return (
    <div className="flex h-screen w-full bg-slate-100 font-sans text-slate-900 overflow-hidden">
      {/* Global Navigation Sidebar */}
      <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col flex-shrink-0 z-20 shadow-[2px_0_15px_-3px_rgba(0,0,0,0.03)]">
        <div className="p-5 flex items-center gap-3 border-b border-slate-200 bg-slate-50">
          <div className="w-8 h-8 bg-teal-600 rounded-lg shadow-md shadow-teal-600/20 flex items-center justify-center text-white font-bold">
            DM
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-800">Data Model Hub</h1>
            <p className="text-xs text-slate-500 font-medium">ER Design Platform</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-8">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3">Navegación</p>
            <ul className="space-y-1.5">
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 hover:bg-white hover:shadow-sm hover:text-teal-600 rounded-lg transition-all border border-transparent hover:border-slate-200">
                  <LayoutDashboard size={18} /> Dashboard
                </button>
              </li>
              <li>
                <button 
                  onClick={() => { setCurrentView('projects'); setActiveProject(null); setActiveModel(null); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all ${currentView.includes('project') || currentView === 'editor' ? 'bg-white shadow-sm border border-slate-200 text-teal-700 font-semibold' : 'text-slate-600 hover:bg-white hover:shadow-sm hover:text-teal-600 border border-transparent hover:border-slate-200'}`}
                >
                  <FolderKanban size={18} /> Proyectos
                </button>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3">Recursos</p>
            <ul className="space-y-1.5">
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 hover:bg-white hover:shadow-sm hover:text-teal-600 rounded-lg transition-all border border-transparent hover:border-slate-200">
                  <FileText size={18} /> Documentación
                </button>
              </li>
              <li>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 hover:bg-white hover:shadow-sm hover:text-teal-600 rounded-lg transition-all border border-transparent hover:border-slate-200">
                  <Settings size={18} /> Configuración
                </button>
              </li>
            </ul>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-sm cursor-pointer hover:border-teal-300 transition-colors">
            <div className="w-8 h-8 rounded-md bg-slate-800 text-white flex items-center justify-center text-sm font-medium">
              U
            </div>
            <div className="text-sm">
              <p className="font-semibold text-slate-700">Usuario Activo</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">v1.0.0</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-100/50">
        {currentView === 'projects' && (
          <ProjectsView 
            onOpenProject={(p) => { setActiveProject(p); setCurrentView('project-details'); }} 
            onOpenProjectCanvas={(p) => { setActiveProject(p); setActiveModel(null); setCurrentView('editor'); }}
          />
        )}
        {currentView === 'project-details' && (
          <ProjectDetailsView 
            project={activeProject} 
            onOpenModel={(m) => { setActiveModel(m); setCurrentView('editor'); }} 
            onOpenProjectCanvas={() => { setActiveModel(null); setCurrentView('editor'); }}
            onBack={() => setCurrentView('projects')} 
          />
        )}
        {currentView === 'editor' && (
          <EditorView 
            project={activeProject}
            model={activeModel}
            onBack={() => { setCurrentView('project-details'); setActiveModel(null); }} 
          />
        )}
      </main>
    </div>
  );
}

// --- VIEW: PROJECTS LIST ---
function ProjectsView({ onOpenProject, onOpenProjectCanvas }) {
  return (
    <div className="flex-1 overflow-auto">
      <header className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Proyectos</h2>
          <p className="text-sm text-slate-500">Gestiona tus proyectos de modelado de datos y ecosistemas</p>
        </div>
        <button className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-teal-700 transition-colors shadow-md shadow-teal-600/20">
          <Plus size={16} /> Nuevo Proyecto
        </button>
      </header>

      <div className="p-8">
        <div className="relative mb-8 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar proyectos..." 
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 shadow-sm rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOCK_PROJECTS.map(project => (
            <div 
              key={project.id} 
              className="bg-white border border-slate-200 rounded-xl p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-teal-400 transition-all group shadow-sm flex flex-col"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 
                  className="font-bold text-lg text-slate-800 cursor-pointer group-hover:text-teal-700 transition-colors"
                  onClick={() => onOpenProject(project)}
                >
                  {project.name}
                </h3>
                <button className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors">
                  <MoreVertical size={18} />
                </button>
              </div>
              
              <p className="text-sm text-slate-500 mb-4 line-clamp-2 leading-relaxed flex-1">{project.desc}</p>
              
              {/* Motores de BD Tags */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {project.engines.map((engine, i) => (
                  <span key={i} className="flex items-center gap-1 bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">
                    <Server size={10} /> {engine}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs font-medium text-slate-500 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-md text-slate-600">
                  <Database size={14} className="text-teal-600" /> {project.modelsCount} modelos
                </div>
                
                {/* Botón para abrir el lienzo global desde la tarjeta */}
                <button 
                  onClick={(e) => { e.stopPropagation(); onOpenProjectCanvas(project); }}
                  className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors font-semibold"
                >
                  <Network size={14} /> Lienzo Global
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- VIEW: PROJECT DETAILS ---
function ProjectDetailsView({ project, onOpenModel, onOpenProjectCanvas, onBack }) {
  return (
    <div className="flex-1 overflow-auto">
      <header className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all shadow-sm">
             <ChevronRight className="rotate-180" size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1 font-medium">
              <span className="hover:text-slate-700 cursor-pointer" onClick={onBack}>Proyectos</span> 
              <ChevronRight size={14} className="text-slate-300" /> 
              <span className="text-slate-700">{project?.name || 'Proyecto'}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800">Soluciones / Modelos de Datos</h2>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={onOpenProjectCanvas}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Network size={16} className="text-indigo-500" /> Lienzo Global
          </button>
          <button className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-teal-700 transition-colors shadow-md shadow-teal-600/20">
            <Plus size={16} /> Nuevo Modelo
          </button>
        </div>
      </header>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-4 font-bold">Nombre del Modelo</th>
                <th className="px-6 py-4 font-bold">Motor DB</th>
                <th className="px-6 py-4 font-bold">Tablas</th>
                <th className="px-6 py-4 font-bold">Última edición</th>
                <th className="px-6 py-4 text-right font-bold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_MODELS.map(model => (
                <tr key={model.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <button onClick={() => onOpenModel(model)} className="font-semibold text-slate-800 group-hover:text-teal-700 flex items-center gap-3 transition-colors">
                      <div className="p-1.5 bg-teal-50 rounded text-teal-600 group-hover:bg-teal-100">
                        <TableProperties size={16} />
                      </div>
                      {model.name}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded w-fit border border-slate-200">
                       <Server size={12}/> {model.engine}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-600">
                    <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-xs">{model.tables}</span>
                  </td>
                  <td className="px-6 py-4 text-slate-500">Hace 2 horas</td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
                      <MoreVertical size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- VIEW: THE EDITOR (Supports Model View and Global Project View) ---
function EditorView({ project, model, onBack }) {
  const [leftTab, setLeftTab] = useState('visual'); 
  const [isAiOpen, setIsAiOpen] = useState(false);
  
  const isGlobalView = !model; // Si no hay un modelo específico, es la vista del proyecto entero.

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100">
      {/* Editor Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 flex items-center justify-between flex-shrink-0 z-20 shadow-sm relative">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all shadow-sm">
            <ChevronRight className="rotate-180" size={18} />
          </button>
          <div className="flex items-center text-sm font-medium">
            <span className="text-slate-500 hidden sm:inline">{project?.name || 'Sales Analytics'}</span>
            <ChevronRight size={14} className="mx-2 text-slate-300 hidden sm:inline" />
            
            {/* Dinámico según la vista (Global vs Específico) */}
            <span className="font-bold text-slate-800 flex items-center gap-2">
              {isGlobalView ? (
                <><Network size={16} className="text-indigo-500"/> Visión Global del Proyecto</>
              ) : (
                <><TableProperties size={16} className="text-teal-600"/> {model.name}</>
              )}
            </span>

            {/* Badges de Motores (editable en futuro) */}
            <div className="hidden md:flex ml-4 gap-1.5 items-center">
              {isGlobalView ? (
                 project?.engines.map((eng, idx) => (
                   <span key={idx} className="flex items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer hover:bg-slate-200 transition-colors">
                      <Server size={10} /> {eng}
                   </span>
                 ))
              ) : (
                 <span className="flex items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer hover:bg-slate-200 transition-colors">
                    <Server size={10} /> {model.engine}
                 </span>
              )}
              <button className="text-slate-400 hover:text-slate-600 p-0.5"><Plus size={14}/></button>
            </div>

            <span className="ml-4 px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 rounded text-[10px] font-bold uppercase tracking-wider">Guardado</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-1 shadow-inner">
             <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white hover:shadow-sm rounded transition-all">
                <Upload size={16} className="text-slate-400" />
                <span className="hidden md:inline">Importar</span>
             </button>
             <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white hover:shadow-sm rounded transition-all">
                <Download size={16} className="text-slate-400" />
                <span className="hidden md:inline">Exportar</span>
             </button>
          </div>

          <div className="w-px h-8 bg-slate-200 mx-1"></div>

          <button 
            onClick={() => setIsAiOpen(!isAiOpen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border ${isAiOpen ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-inner' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'}`}
          >
            <Sparkles size={16} className={isAiOpen ? 'text-indigo-500' : 'text-amber-500'} />
            AI Agent
          </button>
        </div>
      </header>

      {/* Editor Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Panel */}
        <aside className="w-72 border-r border-slate-200 bg-white flex flex-col flex-shrink-0 z-10 shadow-[4px_0_24px_-10px_rgba(0,0,0,0.05)]">
          <div className="flex p-3 border-b border-slate-100 bg-slate-50">
            <div className="flex-1 flex bg-slate-200/50 p-1 rounded-lg">
              <button 
                onClick={() => setLeftTab('visual')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-sm font-semibold rounded-md transition-all ${leftTab === 'visual' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <TableProperties size={16} /> Entidades
              </button>
              <button 
                onClick={() => setLeftTab('code')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-sm font-semibold rounded-md transition-all ${leftTab === 'code' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Code2 size={16} /> Código
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col">
            {leftTab === 'visual' ? (
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                  <h3 className="font-semibold text-slate-800 text-sm">
                    {isGlobalView ? 'Todas las Entidades' : 'Tablas del Modelo'}
                  </h3>
                  <button className="p-1.5 text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-md transition-colors" title="Crear tabla manualmente">
                    <Plus size={18} />
                  </button>
                </div>
                <div className="p-2 overflow-y-auto flex-1 space-y-1">
                  {MOCK_TABLES.map(table => (
                    <div key={table.id} className="flex flex-col p-2 hover:bg-slate-50 rounded-lg cursor-pointer group border border-transparent hover:border-slate-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <TableProperties size={14} className="text-slate-400 group-hover:text-teal-600" />
                          <span>{table.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{table.columns} cols</span>
                      </div>
                      {isGlobalView && (
                        <div className="text-[10px] text-slate-400 mt-1 pl-6 flex items-center gap-1">
                          <BoxSelect size={10} /> {table.model}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col bg-[#1e1e2e] text-slate-300">
                 <div className="p-2 border-b border-slate-700/50 flex justify-between items-center text-xs text-slate-400">
                    <span>{isGlobalView ? 'project.dbml' : 'model.dbml'}</span>
                    <button className="hover:text-white">Formatear</button>
                 </div>
                 <textarea 
                  className="flex-1 w-full bg-transparent p-4 text-sm font-mono focus:outline-none resize-none leading-relaxed text-[#cdd6f4]"
                  defaultValue={DBML_CODE}
                  spellCheck="false"
                 />
              </div>
            )}
          </div>
        </aside>

        {/* Center Canvas */}
        <div className="flex-1 bg-slate-100 relative overflow-hidden" style={{ backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
             
             {/* BLOQUES DE FONDO (NAMESPACES / MODELOS) - Solo visibles en Global View */}
             {isGlobalView && (
               <>
                 {/* Namespace 1: Main Data Model */}
                 <div className="absolute top-16 left-12 w-[650px] h-[380px] bg-slate-200/40 border-2 border-dashed border-slate-300 rounded-2xl">
                    <div className="absolute -top-3 left-6 px-3 bg-slate-100 text-slate-500 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                       <BoxSelect size={14} /> Main Data Model
                       <span className="ml-2 bg-white px-1.5 py-0.5 rounded text-[9px] border border-slate-200"><Server size={8} className="inline mr-1"/>PostgreSQL</span>
                    </div>
                 </div>

                 {/* Namespace 2: Staging Area */}
                 <div className="absolute top-[450px] left-12 w-[400px] h-[250px] bg-indigo-50/40 border-2 border-dashed border-indigo-200 rounded-2xl">
                    <div className="absolute -top-3 left-6 px-3 bg-slate-100 text-indigo-500 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                       <BoxSelect size={14} /> Staging Area Schema
                       <span className="ml-2 bg-white text-slate-500 px-1.5 py-0.5 rounded text-[9px] border border-slate-200"><Server size={8} className="inline mr-1"/>Databricks SQL</span>
                    </div>
                 </div>
               </>
             )}


             {/* TABLAS */}
             <div className="absolute top-28 left-24 w-64 bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden pointer-events-auto transition-transform hover:-translate-y-1">
                <div className="bg-slate-800 text-white px-4 py-3 text-sm font-bold flex justify-between items-center border-b border-slate-700">
                   <span>orders</span>
                   <span className="bg-slate-700 px-2 py-0.5 rounded text-xs">4</span>
                </div>
                <div className="p-2">
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="font-medium text-amber-600">PK id</span><span className="text-slate-400">integer</span></div>
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="font-medium text-indigo-500">FK user_id</span><span className="text-slate-400">integer</span></div>
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="text-slate-700">total</span><span className="text-slate-400">decimal</span></div>
                </div>
             </div>

             <div className="absolute top-48 left-[420px] w-64 bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden pointer-events-auto transition-transform hover:-translate-y-1">
                <div className="bg-slate-800 text-white px-4 py-3 text-sm font-bold flex justify-between items-center border-b border-slate-700">
                   <span>users</span>
                   <span className="bg-slate-700 px-2 py-0.5 rounded text-xs">5</span>
                </div>
                <div className="p-2">
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="font-medium text-amber-600">PK id</span><span className="text-slate-400">integer</span></div>
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="text-slate-700">username</span><span className="text-slate-400">varchar</span></div>
                  <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="text-slate-700">email</span><span className="text-slate-400">varchar</span></div>
                </div>
             </div>

             {/* Tabla perteneciente a otro modelo (Staging) - Visible solo si es global o el modelo actual */}
             {(isGlobalView || model?.name === 'Staging Area Schema') && (
               <div className={`absolute ${isGlobalView ? 'top-[490px] left-24' : 'top-32 left-24'} w-64 bg-white rounded-xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden pointer-events-auto transition-transform hover:-translate-y-1`}>
                  <div className={`${isGlobalView ? 'bg-indigo-900' : 'bg-slate-800'} text-white px-4 py-3 text-sm font-bold flex justify-between items-center border-b border-slate-700`}>
                     <span>raw_events</span>
                     <span className="bg-slate-700 px-2 py-0.5 rounded text-xs">15</span>
                  </div>
                  <div className="p-2">
                    <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="font-medium text-amber-600">PK event_id</span><span className="text-slate-400">varchar</span></div>
                    <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="text-slate-700">payload</span><span className="text-slate-400">jsonb</span></div>
                    <div className="flex justify-between py-1 border-b border-slate-50 text-xs"><span className="text-slate-700">ingested_at</span><span className="text-slate-400">timestamp</span></div>
                  </div>
               </div>
             )}

             {/* Conexiones */}
             <svg className="absolute top-0 left-0 w-full h-full" style={{zIndex: -1}}>
                {/* Relación local (orders -> users) */}
                <path d="M 336 181 L 380 181 L 380 231 L 420 231" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" />
                <circle cx="336" cy="181" r="4" fill="#94a3b8" />
                <path d="M 415 226 L 420 231 L 415 236" fill="none" stroke="#94a3b8" strokeWidth="2"/>

                {/* Conexión "Cross-Model" ficticia (solo en global) */}
                {isGlobalView && (
                  <>
                    <path d="M 353 506 L 550 506 L 550 280 L 490 280" fill="none" stroke="#818cf8" strokeWidth="2" />
                    <circle cx="353" cy="506" r="4" fill="#818cf8" />
                    <rect x="540" y="380" width="20" height="20" fill="white" stroke="#818cf8" rx="4"/>
                    <text x="546" y="394" fill="#818cf8" fontSize="12" fontWeight="bold">API</text>
                  </>
                )}
             </svg>
          </div>

          {/* Canvas Controls */}
          <div className="absolute bottom-8 right-8 flex bg-white rounded-lg shadow-lg shadow-slate-200/50 border border-slate-200 p-1.5 z-10">
            <button className="p-2 hover:bg-slate-100 rounded-md text-slate-600 transition-colors"><Plus size={18}/></button>
            <button className="p-2 hover:bg-slate-100 rounded-md text-slate-600 transition-colors"><Minus size={18}/></button>
            <div className="w-px h-6 bg-slate-200 mx-1.5 self-center"></div>
            <button className="p-2 hover:bg-slate-100 rounded-md text-slate-600 transition-colors"><Maximize size={18}/></button>
          </div>
        </div>

        {/* Right Panel: AI Assistant */}
        {isAiOpen && (
          <aside className="w-[350px] border-l border-slate-200 bg-white flex flex-col flex-shrink-0 z-20 shadow-[-8px_0_24px_-10px_rgba(0,0,0,0.08)]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-indigo-50/80 to-white">
              <div className="flex items-center gap-2 text-indigo-700 font-bold">
                <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
                   <Sparkles size={16} />
                </div>
                <h3>AI Model Assistant</h3>
              </div>
              <button onClick={() => setIsAiOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 p-5 overflow-y-auto bg-slate-50 space-y-5">
               {/* Welcome Message */}
               <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-4 shadow-sm text-sm text-slate-700 leading-relaxed">
                 ¡Hola! Soy tu asistente. Puedes pedirme que cruce información de modelos, cree esquemas o configure integraciones cross-database.
               </div>

               {/* Mock User Message */}
               <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm p-4 shadow-md shadow-indigo-600/20 text-sm ml-6 leading-relaxed">
                 Conecta el modelo de Staging (Databricks) con el Main Model (PostgreSQL) usando una vista materializada.
               </div>

               {/* Mock AI Response */}
               <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-4 shadow-sm text-sm text-slate-700 leading-relaxed">
                 <p className="mb-3">Hecho. He trazado una relación cross-model basada en la sincronización de <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs font-semibold border border-slate-200">raw_events</span> hacia <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs font-semibold border border-slate-200">users</span> a través de una capa API.</p>
                 <button className="w-full justify-center bg-indigo-50 text-indigo-700 font-bold text-xs py-2 px-3 rounded-lg flex items-center gap-2 hover:bg-indigo-100 transition-colors border border-indigo-100">
                    <Network size={14}/> Aplicar al Lienzo Global
                 </button>
               </div>
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-slate-200 bg-white">
              <div className="relative shadow-sm rounded-xl">
                <textarea 
                  placeholder="Describe la integración de tus datos..." 
                  className="w-full bg-white border border-slate-300 rounded-xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 resize-none min-h-[90px] transition-all"
                ></textarea>
                <button className="absolute right-3 bottom-3 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/20 hover:-translate-y-0.5">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}