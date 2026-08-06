import type { CapabilityLibraryCategory } from "../../../../pages/spaces/spacePageModel";

interface CapabilityLibraryDiagramProps {
  category: CapabilityLibraryCategory;
}

function DiagramFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="dial-archive-capability-library-diagram__frame">
      <span className="dial-archive-capability-library-diagram__coordinate is-top">Y // 041</span>
      <span className="dial-archive-capability-library-diagram__coordinate is-right">X // 806</span>
      <span className="dial-archive-capability-library-diagram__cross is-a" aria-hidden="true" />
      <span className="dial-archive-capability-library-diagram__cross is-b" aria-hidden="true" />
      {children}
      <div className="dial-archive-capability-library-diagram__scale" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    </div>
  );
}

function ProviderDiagram() {
  return (
    <DiagramFrame>
      <div className="dial-archive-capability-library-pvd">
        <div className="dial-archive-capability-library-pvd__spine">
          <span>PVD</span>
          <small>GATEWAY</small>
        </div>
        <div className="dial-archive-capability-library-pvd__gate">
          <div className="dial-archive-capability-library-pvd__gate-ring is-outer" />
          <div className="dial-archive-capability-library-pvd__gate-ring is-middle" />
          <div className="dial-archive-capability-library-pvd__gate-ring is-inner" />
          <span className="dial-archive-capability-library-pvd__core">API</span>
        </div>
        <div className="dial-archive-capability-library-pvd__route is-a">
          <i />
        </div>
        <div className="dial-archive-capability-library-pvd__route is-b">
          <i />
        </div>
        <div className="dial-archive-capability-library-pvd__route is-c">
          <i />
        </div>
        <div className="dial-archive-capability-library-pvd__route is-d">
          <i />
        </div>
        <div className="dial-archive-capability-library-pvd__plate">
          <span>MODEL ROUTING</span>
          <strong>04</strong>
        </div>
      </div>
    </DiagramFrame>
  );
}

function TaggerDiagram() {
  return (
    <DiagramFrame>
      <div className="dial-archive-capability-library-tag">
        <div className="dial-archive-capability-library-tag__sensor">
          <span className="is-north" />
          <span className="is-east" />
          <span className="is-south" />
          <span className="is-west" />
          <strong>TAG</strong>
          <small>LOCAL CORE</small>
        </div>
        <div className="dial-archive-capability-library-tag__card is-a">
          <span>01</span>
          <b>VISION</b>
          <i />
        </div>
        <div className="dial-archive-capability-library-tag__card is-b">
          <span>02</span>
          <b>VOCAB</b>
          <i />
        </div>
        <div className="dial-archive-capability-library-tag__card is-c">
          <span>03</span>
          <b>PROFILE</b>
          <i />
        </div>
        <div className="dial-archive-capability-library-tag__baseline">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </DiagramFrame>
  );
}

function DictionaryDiagram() {
  return (
    <DiagramFrame>
      <div className="dial-archive-capability-library-dic">
        <div className="dial-archive-capability-library-dic__index">
          <span>DIC</span>
          <small>LEXICON ARRAY</small>
        </div>
        <div className="dial-archive-capability-library-dic__slab is-back">
          <span>03</span>
          <b>OVERRIDE</b>
          <i />
          <i />
          <i />
        </div>
        <div className="dial-archive-capability-library-dic__slab is-middle">
          <span>02</span>
          <b>PRIORITY</b>
          <i />
          <i />
          <i />
        </div>
        <div className="dial-archive-capability-library-dic__slab is-front">
          <span>01</span>
          <b>ENTRY INDEX</b>
          <i />
          <i />
          <i />
        </div>
        <div className="dial-archive-capability-library-dic__pin is-a" />
        <div className="dial-archive-capability-library-dic__pin is-b" />
      </div>
    </DiagramFrame>
  );
}

function PromptDiagram() {
  return (
    <DiagramFrame>
      <div className="dial-archive-capability-library-prm">
        <div className="dial-archive-capability-library-prm__rail">
          <strong>PRM</strong>
          <span>PROTOCOL</span>
        </div>
        <div className="dial-archive-capability-library-prm__sheet is-back">
          <span>TRANSLATE // 02</span>
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="dial-archive-capability-library-prm__sheet is-front">
          <span>SYSTEM // 01</span>
          <strong>
            STRUCTURED
            <br />
            INSTRUCTION
          </strong>
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="dial-archive-capability-library-prm__seal">V2</div>
      </div>
    </DiagramFrame>
  );
}

function SystemDiagram() {
  return (
    <DiagramFrame>
      <div className="dial-archive-capability-library-sys">
        <div className="dial-archive-capability-library-sys__bar">
          <span>STUDIO CONTROL</span>
          <strong>SYS</strong>
        </div>
        <div className="dial-archive-capability-library-sys__screen">
          <div className="dial-archive-capability-library-sys__radar">
            <span className="is-a" />
            <span className="is-b" />
            <span className="is-c" />
            <i />
          </div>
          <div className="dial-archive-capability-library-sys__readout">
            <span>
              <b>01</b> INTERFACE
            </span>
            <span>
              <b>02</b> BULLETIN
            </span>
            <span>
              <b>03</b> DIAGNOSTIC
            </span>
          </div>
        </div>
        <div className="dial-archive-capability-library-sys__signal">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </DiagramFrame>
  );
}

export function CapabilityLibraryDiagram({ category }: CapabilityLibraryDiagramProps) {
  return (
    <div
      className={`dial-archive-capability-library-diagram is-${category.id}`}
      role="img"
      aria-label={`${category.code} ${category.label}技术构件`}
    >
      {category.id === "providers" ? (
        <ProviderDiagram />
      ) : category.id === "taggers" ? (
        <TaggerDiagram />
      ) : category.id === "dictionaries" ? (
        <DictionaryDiagram />
      ) : category.id === "prompts" ? (
        <PromptDiagram />
      ) : (
        <SystemDiagram />
      )}
    </div>
  );
}
